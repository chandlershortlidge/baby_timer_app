import json
from datetime import datetime, timedelta
from baby_timer_app.app import get_db_connection


def test_get_today_not_started(client):
    """Test that getting today's schedule before it's started returns a 'not_found' status."""
    response = client.get('/api/day/today')
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data['status'] == 'not_found'


def test_log_wake_time_and_initialize_day(client, app):
    """Test logging the morning wake-up, which should create the day's record and nap slots."""
    timestamp = datetime.now().isoformat() + 'Z'
    response = client.post('/api/day/bedtime', json={
        'type': 'wake',
        'timestamp': timestamp
    })
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data['status'] == 'success'
    assert 'schedule initialized' in data['message']

    # Now verify the data was written to the database
    with app.app_context():
        conn = get_db_connection()
        today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        day = conn.execute('SELECT * FROM days WHERE date = ?', (today_str,)).fetchone()
        assert day is not None
        assert day['first_wake_at'] == timestamp

        naps = conn.execute('SELECT * FROM nap_slots WHERE day_id = ?', (day['id'],)).fetchall()
        assert len(naps) == 3  # Based on the default plan in app.py
        assert naps[0]['nap_index'] == 1
        conn.close()


def test_start_and_stop_nap(client):
    """Test the full lifecycle of starting and stopping a nap."""
    # 1. Start the day
    wake_time = datetime.now()
    wake_timestamp = wake_time.isoformat() + 'Z'
    client.post('/api/day/bedtime', json={'type': 'wake', 'timestamp': wake_timestamp})

    # 2. Start the first nap
    start_time = wake_time + timedelta(hours=1.5)
    start_timestamp = start_time.isoformat() + 'Z'
    response = client.post('/api/naps/start', json={'index': 1, 'timestamp': start_timestamp})
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data['status'] == 'success'

    # 3. Stop the first nap
    stop_time = start_time + timedelta(minutes=45)
    stop_timestamp = stop_time.isoformat() + 'Z'
    response = client.post('/api/naps/stop', json={'index': 1, 'timestamp': stop_timestamp})
    assert response.status_code == 200
    data = json.loads(response.data)
    assert data['status'] == 'success'
    assert 'schedule adjusted' in data['message']

    # 4. Verify the state via get_today
    response = client.get('/api/day/today')
    assert response.status_code == 200
    day_data = json.loads(response.data)
    assert day_data['day']['first_wake_at'] == wake_timestamp
    nap1 = day_data['naps'][0]
    assert nap1['nap_index'] == 1
    assert nap1['status'] == 'finished'
    assert nap1['actual_start_at'] == start_timestamp
    assert nap1['actual_end_at'] == stop_timestamp


def test_schedule_adjustment_on_long_nap(client, app):
    """Test that a long nap correctly shortens upcoming naps."""
    wake_timestamp = datetime.now().isoformat() + 'Z'
    client.post('/api/day/bedtime', json={'type': 'wake', 'timestamp': wake_timestamp})

    start_time = datetime.fromisoformat(wake_timestamp.replace('Z', '+00:00')) + timedelta(hours=1)
    client.post('/api/naps/start', json={'index': 1, 'timestamp': start_time.isoformat() + 'Z'})

    # Planned duration is 45min. Make this one 60min (+15min / +900s).
    stop_time = start_time + timedelta(minutes=60)
    client.post('/api/naps/stop', json={'index': 1, 'timestamp': stop_time.isoformat() + 'Z'})

    # The +900s delta should be distributed among the 2 remaining naps (-450s each).
    response = client.get('/api/day/today')
    data = json.loads(response.data)
    assert data['naps'][1]['adjusted_duration_sec'] == 3600 - 450  # 60min -> 52.5min
    assert data['naps'][2]['adjusted_duration_sec'] == 1800 - 450  # 30min -> 22.5min