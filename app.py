import os
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, current_app

# Import the configuration
from .config import Config

def get_db_connection():
    """Establishes a connection to the database and sets the row factory."""
    db_path = os.path.join(current_app.instance_path, current_app.config['DATABASE'])
    conn = sqlite3.connect(db_path)
    # Return rows as objects that can be accessed by column name
    conn.row_factory = sqlite3.Row
    return conn

def create_db(app):
    """
    Creates the SQLite database and tables if they don't exist.
    This new schema is more robust and supports dynamic adjustments.
    """
    db_path = os.path.join(app.instance_path, app.config['DATABASE'])
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    # Drop old table for a clean slate during development.
    # In a production migration, you'd use ALTER TABLE or a migration script.
    c.execute('DROP TABLE IF EXISTS nap_plans')

    # The 'days' table is the central record for a single day's schedule.
    c.execute('''
        CREATE TABLE IF NOT EXISTS days (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            first_wake_at TEXT,
            bedtime_start_at TEXT,
            total_night_sleep_sec INTEGER,
            daily_awake_budget_sec INTEGER,
            projected_bedtime_at TEXT
        )
    ''')

    # Ensure new columns exist for evolving schema without clobbering data.
    for ddl in (
        "ALTER TABLE days ADD COLUMN bedtime_start_at TEXT",
        "ALTER TABLE days ADD COLUMN total_night_sleep_sec INTEGER",
    ):
        try:
            c.execute(ddl)
        except sqlite3.OperationalError:
            pass

    # 'nap_slots' holds the plan and actuals for each individual nap.
    c.execute('''
        CREATE TABLE IF NOT EXISTS nap_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_id INTEGER NOT NULL,
            nap_index INTEGER NOT NULL,
            planned_duration_sec INTEGER NOT NULL,
            adjusted_duration_sec INTEGER, -- This will be updated by the schedule adjustment logic.
            actual_start_at TEXT,
            actual_end_at TEXT,
            status TEXT NOT NULL DEFAULT 'upcoming',
            FOREIGN KEY (day_id) REFERENCES days (id)
        )
    ''')

    # Track bedtime sessions to calculate overnight sleep duration.
    c.execute('''
        CREATE TABLE IF NOT EXISTS sleep_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_at TEXT NOT NULL,
            end_at TEXT,
            total_sleep_sec INTEGER
        )
    ''')
    conn.commit()
    conn.close()

def _adjust_schedule(conn, day_id, finished_nap_index):
    """
    Recalculates the duration of upcoming naps based on the deviation
    of the nap that just finished.
    """
    # 1. Get the details of the nap that just finished
    finished_nap_cursor = conn.execute(
        'SELECT actual_start_at, actual_end_at, planned_duration_sec FROM nap_slots WHERE day_id = ? AND nap_index = ?',
        (day_id, finished_nap_index)
    )
    finished_nap = finished_nap_cursor.fetchone()

    if not all([finished_nap, finished_nap['actual_start_at'], finished_nap['actual_end_at']]):
        # Not enough data to perform adjustment
        current_app.logger.warning(f"Could not adjust schedule; finished nap {finished_nap_index} lacks start/end times.")
        return

    # 2. Calculate the time deviation
    start_time = datetime.fromisoformat(finished_nap['actual_start_at'].replace('Z', '+00:00'))
    end_time = datetime.fromisoformat(finished_nap['actual_end_at'].replace('Z', '+00:00'))
    actual_duration_sec = (end_time - start_time).total_seconds()
    planned_duration_sec = finished_nap['planned_duration_sec']

    time_delta_sec = actual_duration_sec - planned_duration_sec

    # 3. Find all upcoming naps
    upcoming_naps_cursor = conn.execute(
        "SELECT id, nap_index, planned_duration_sec, adjusted_duration_sec FROM nap_slots WHERE day_id = ? AND status = 'upcoming' ORDER BY nap_index",
        (day_id,)
    )
    upcoming_naps = upcoming_naps_cursor.fetchall()

    if not upcoming_naps:
        current_app.logger.info("No upcoming naps to adjust.")
        return

    # 4. Distribute the time delta among upcoming naps
    # A positive delta (long nap) means we need to shorten future naps.
    adjustment_per_nap = time_delta_sec / len(upcoming_naps)
    current_app.logger.info(f"Nap {finished_nap_index} was {time_delta_sec:.0f}s off plan. Adjusting {len(upcoming_naps)} upcoming naps by {-adjustment_per_nap:.0f}s each.")

    for nap in upcoming_naps:
        # The base for adjustment is the previously adjusted duration, or the original plan if never adjusted.
        base_duration = nap['adjusted_duration_sec'] if nap['adjusted_duration_sec'] is not None else nap['planned_duration_sec']
        # Subtract the adjustment: if nap was long (positive delta), we shorten future naps.
        new_adjusted_duration = base_duration - adjustment_per_nap
        # Sanity check: ensure naps are not adjusted to be too short (e.g., less than 10 minutes)
        MIN_NAP_DURATION_SEC = 10 * 60
        final_duration = max(MIN_NAP_DURATION_SEC, new_adjusted_duration)

        conn.execute('UPDATE nap_slots SET adjusted_duration_sec = ? WHERE id = ?', (final_duration, nap['id']))
        current_app.logger.info(f"Nap {nap['nap_index']} duration adjusted to {final_duration:.0f} seconds.")

def create_app(test_config=None):
    """
    Application factory for the Flask app.
    """
    app = Flask(__name__, instance_relative_config=True)
    # Load configuration from the 'config.py' file. This will set app.secret_key
    # and other config variables from the Config class.
    app.config.from_object(Config)

    if test_config:
        app.config.update(test_config)

    # Ensure the instance folder exists. Flask does not create it automatically,
    # but it's required for our database.
    try:
        os.makedirs(app.instance_path)
    except OSError:
        # Already exists or other error. Let it fail later if it's a real issue.
        pass

    create_db(app)
    @app.route('/')
    def index():
        """
        Renders the main home screen of the app.
        """
        return render_template('index.html')

    # --- New API Endpoints ---

    @app.route('/api/day/today', methods=['GET'])
    def get_today():
        """
        Fetches the complete schedule for the current day, including the
        day's overall data and the status of all its nap slots.
        """
        today_str = datetime.now().strftime('%Y-%m-%d')
        conn = get_db_connection()
        try:
            day_cursor = conn.execute('SELECT * FROM days WHERE date = ?', (today_str,))
            day_row = day_cursor.fetchone()

            sleep_cursor = conn.execute(
                'SELECT start_at FROM sleep_sessions WHERE end_at IS NULL ORDER BY id DESC LIMIT 1'
            )
            sleep_row = sleep_cursor.fetchone()
            sleep_session = dict(sleep_row) if sleep_row else None

            if not day_row:
                response = {"status": "not_found", "message": "Today's schedule has not been started yet."}
                if sleep_session:
                    response["sleep_session"] = sleep_session
                return response

            day_data = dict(day_row)
            day_id = day_data['id']

            naps_cursor = conn.execute(
                'SELECT * FROM nap_slots WHERE day_id = ? ORDER BY nap_index',
                (day_id,)
            )
            naps_data = [dict(row) for row in naps_cursor.fetchall()]

            response_data = {
                "day": day_data,
                "naps": naps_data
            }
            if sleep_session:
                response_data["sleep_session"] = sleep_session
            return response_data

        except sqlite3.Error as e:
            app.logger.error(f"Database error in get_today: {e}")
            return {"status": "error", "message": "Failed to fetch today's schedule."}, 500
        finally:
            if conn:
                conn.close()

    @app.route('/api/day/bedtime', methods=['POST'])
    def log_bedtime():
        """
        Logs the start of nighttime sleep or the morning wake-up ('firstWakeAt').
        When the morning wake-up is logged, it initializes the nap schedule for the day.
        """
        data = request.json
        event_type = data.get('type')
        timestamp = data.get('timestamp')

        if event_type == 'sleep' and timestamp:
            conn = get_db_connection()
            try:
                with conn:
                    open_session = conn.execute(
                        'SELECT id FROM sleep_sessions WHERE end_at IS NULL ORDER BY id DESC LIMIT 1'
                    ).fetchone()
                    if open_session:
                        conn.execute(
                            'UPDATE sleep_sessions SET start_at = ?, end_at = NULL, total_sleep_sec = NULL WHERE id = ?',
                            (timestamp, open_session['id'])
                        )
                    else:
                        conn.execute(
                            'INSERT INTO sleep_sessions (start_at) VALUES (?)',
                            (timestamp,)
                        )
                return {"status": "success", "message": "Bedtime started."}
            except sqlite3.Error as e:
                app.logger.error(f"Database error in log_bedtime sleep: {e}")
                return {"status": "error", "message": "Failed to log bedtime start."}, 500
            finally:
                if conn:
                    conn.close()

        if event_type == 'wake' and timestamp:
            # Use the timestamp from the request to determine the date
            today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
            conn = get_db_connection()
            try:
                with conn:
                    bedtime_start_at = None
                    total_sleep_sec = None

                    sleep_row = conn.execute(
                        'SELECT id, start_at FROM sleep_sessions WHERE end_at IS NULL ORDER BY id DESC LIMIT 1'
                    ).fetchone()

                    if sleep_row and sleep_row['start_at']:
                        try:
                            start_dt = datetime.fromisoformat(sleep_row['start_at'].replace('Z', '+00:00'))
                            end_dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                            total_sleep_sec = max(0, int((end_dt - start_dt).total_seconds()))
                            bedtime_start_at = sleep_row['start_at']
                            conn.execute(
                                'UPDATE sleep_sessions SET end_at = ?, total_sleep_sec = ? WHERE id = ?',
                                (timestamp, total_sleep_sec, sleep_row['id'])
                            )
                        except ValueError:
                            current_app.logger.warning("Invalid timestamp encountered while closing sleep session.")

                    # Use "UPSERT" to either insert a new day or update the existing one
                    conn.execute('''
                        INSERT INTO days (date, first_wake_at, bedtime_start_at, total_night_sleep_sec)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(date) DO UPDATE SET first_wake_at = excluded.first_wake_at,
                                                      bedtime_start_at = excluded.bedtime_start_at,
                                                      total_night_sleep_sec = excluded.total_night_sleep_sec
                    ''', (today_str, timestamp, bedtime_start_at, total_sleep_sec))

                    # Get the ID of the day we just created/updated
                    day_cursor = conn.execute('SELECT id FROM days WHERE date = ?', (today_str,))
                    day_row = day_cursor.fetchone()
                    if not day_row:
                        return {"status": "error", "message": "Failed to create or find day record."}, 500
                    day_id = day_row['id']

                    # --- Initialize Nap Schedule for the Day ---
                    # First, clear any existing naps for this day to handle updates cleanly.
                    conn.execute('DELETE FROM nap_slots WHERE day_id = ?', (day_id,))

                    # Define a default nap plan (could be dynamic in the future)
                    default_nap_plan = [
                        {'index': 1, 'duration_min': 45},
                        {'index': 2, 'duration_min': 60},
                        {'index': 3, 'duration_min': 30},
                    ]

                    for nap in default_nap_plan:
                        conn.execute('''
                            INSERT INTO nap_slots (day_id, nap_index, planned_duration_sec)
                            VALUES (?, ?, ?)
                        ''', (day_id, nap['index'], nap['duration_min'] * 60))

                return {"status": "success", "message": f"Wake time for {today_str} logged and nap schedule initialized."}
            except sqlite3.Error as e:
                app.logger.error(f"Database error in log_bedtime: {e}")
                return {"status": "error", "message": "Failed to log wake time."}, 500
            finally:
                if conn:
                    conn.close()

        return {"status": "error", "message": "Invalid event type or missing timestamp."}, 400

    @app.route('/api/naps/start', methods=['POST'])
    def start_nap():
        """Logs the start of a specific nap."""
        data = request.json
        nap_index = data.get('index')
        timestamp = data.get('timestamp')

        if not all([nap_index, timestamp]):
            return {"status": "error", "message": "Missing nap index or timestamp."}, 400

        today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        conn = get_db_connection()
        try:
            with conn:
                day_cursor = conn.execute('SELECT id FROM days WHERE date = ?', (today_str,))
                day_row = day_cursor.fetchone()
                if not day_row:
                    return {"status": "error", "message": "Day not started. Log morning wake time first."}, 404
                day_id = day_row['id']

                cursor = conn.execute('''
                    UPDATE nap_slots
                    SET actual_start_at = ?, status = 'in_progress'
                    WHERE day_id = ? AND nap_index = ?
                ''', (timestamp, day_id, nap_index))

                if cursor.rowcount == 0:
                    return {"status": "error", "message": f"Nap with index {nap_index} not found for today."}, 404

            return {"status": "success", "message": f"Nap {nap_index} start logged."}
        except sqlite3.Error as e:
            app.logger.error(f"Database error in start_nap: {e}")
            return {"status": "error", "message": "Failed to log nap start."}, 500
        finally:
            if conn:
                conn.close()


    @app.route('/api/naps/update', methods=['POST'])
    def update_nap():
        """Updates the duration of a specific nap.
        - upcoming  -> planned_duration_sec
        - in_progress -> adjusted_duration_sec (affects the live timer)
        Accepts an optional "date" field so clients in different timezones can
        target the intended day explicitly.
        """
        data = request.json
        nap_index = data.get('index')
        new_duration_min = data.get('duration_min')
        request_date = data.get('date')

        if nap_index is None or new_duration_min is None:
            return {"status": "error", "message": "Missing nap index or duration."}, 400

        try:
            new_duration_sec = int(new_duration_min) * 60
        except (ValueError, TypeError):
            return {"status": "error", "message": "Invalid duration format."}, 400

        if request_date:
            try:
                if 'T' in request_date:
                    target_date = datetime.fromisoformat(request_date.replace('Z', '+00:00')).strftime('%Y-%m-%d')
                else:
                    target_date = request_date.strip()
            except ValueError:
                return {"status": "error", "message": "Invalid date format."}, 400
        else:
            target_date = datetime.now().strftime('%Y-%m-%d')

        conn = get_db_connection()
        try:
            with conn:
                day_row = conn.execute('SELECT id FROM days WHERE date = ?', (target_date,)).fetchone()
                if not day_row:
                    return {"status": "error", "message": "Day not started."}, 404
                day_id = day_row['id']

                # find the nap + its status
                nap_row = conn.execute(
                    'SELECT id, status FROM nap_slots WHERE day_id = ? AND nap_index = ?',
                    (day_id, nap_index)
                ).fetchone()
                if not nap_row:
                    return {"status": "error", "message": f"Nap with index {nap_index} not found."}, 404

                status = nap_row['status']
                if status == 'in_progress':
                    # live nap: set adjusted (do not rewrite planned)
                    cursor = conn.execute(
                        'UPDATE nap_slots SET adjusted_duration_sec = ? WHERE id = ?',
                        (new_duration_sec, nap_row['id'])
                    )
                elif status == 'upcoming':
                    # future plan: rewrite planned and clear any prior adjustment
                    cursor = conn.execute(
                        'UPDATE nap_slots SET planned_duration_sec = ?, adjusted_duration_sec = NULL WHERE id = ?',
                        (new_duration_sec, nap_row['id'])
                    )
                else:
                    return {"status": "error",
                            "message": f"Upcoming or in-progress nap with index {nap_index} not found or cannot be edited."}, 404

                if cursor.rowcount == 0:
                    return {"status": "error", "message": "No rows updated."}, 400

            return {"status": "success", "message": f"Nap {nap_index} duration updated."}
        except sqlite3.Error as e:
            current_app.logger.error(f"Database error in update_nap: {e}")
            return {"status": "error", "message": "Failed to update nap."}, 500
        finally:
            if conn:
                conn.close()

    @app.route('/api/naps/stop', methods=['POST'])
    def stop_nap():
        """Logs the end of a nap and triggers schedule adjustment logic."""
        data = request.json
        nap_index = data.get('index')
        timestamp = data.get('timestamp')

        if not all([nap_index, timestamp]):
            return {"status": "error", "message": "Missing nap index or timestamp."}, 400

        today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        conn = get_db_connection()
        try:
            with conn:
                day_row = conn.execute('SELECT id FROM days WHERE date = ?', (today_str,)).fetchone()
                if not day_row:
                    return {"status": "error", "message": "Day not started. Log morning wake time first."}, 404
                day_id = day_row['id']

                cursor = conn.execute('''
                    UPDATE nap_slots
                    SET actual_end_at = ?, status = 'finished'
                    WHERE day_id = ? AND nap_index = ?
                ''', (timestamp, day_id, nap_index))

                if cursor.rowcount == 0:
                    return {"status": "error", "message": f"Nap with index {nap_index} not found for today."}, 404

                # adjust remaining schedule based on the finished nap
                _adjust_schedule(conn, day_id, nap_index)

            return {"status": "success", "message": f"Nap {nap_index} stop logged and schedule adjusted."}
        except sqlite3.Error as e:
            current_app.logger.error(f"Database error in stop_nap: {e}")
            return {"status": "error", "message": "Failed to log nap stop."}, 500
        finally:
            if conn:
                conn.close()
            
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True)
