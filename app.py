import sqlite3
from datetime import datetime
from flask import Flask, render_template, request

# Import the configuration
from .config import Config

# Define the database file
DB_FILE = 'nap_plans.db'

def get_db_connection():
    """Establishes a connection to the database and sets the row factory."""
    conn = sqlite3.connect(DB_FILE)
    # Return rows as objects that can be accessed by column name
    conn.row_factory = sqlite3.Row
    return conn

def create_db():
    """
    Creates the SQLite database and tables if they don't exist.
    This new schema is more robust and supports dynamic adjustments.
    """
    conn = sqlite3.connect(DB_FILE)
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
            daily_awake_budget_sec INTEGER,
            projected_bedtime_at TEXT
        )
    ''')

    # 'nap_slots' holds the plan and actuals for each individual nap.
    c.execute('''
        CREATE TABLE IF NOT EXISTS nap_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_id INTEGER NOT NULL,
            nap_index INTEGER NOT NULL,
            planned_duration_sec INTEGER NOT NULL,
            adjusted_duration_sec INTEGER,
            actual_start_at TEXT,
            actual_end_at TEXT,
            status TEXT NOT NULL DEFAULT 'upcoming',
            FOREIGN KEY (day_id) REFERENCES days (id)
        )
    ''')
    conn.commit()
    conn.close()

def create_app():
    """
    Application factory for the Flask app.
    """
    app = Flask(__name__)
    # Load configuration from the 'config.py' file. This will set app.secret_key
    # and other config variables from the Config class.
    app.config.from_object(Config)

    create_db()
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

            if not day_row:
                return {"status": "not_found", "message": "Today's schedule has not been started yet."}

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

        if event_type == 'wake' and timestamp:
            # Use the timestamp from the request to determine the date
            today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
            conn = get_db_connection()
            try:
                with conn:
                    # Use "UPSERT" to either insert a new day or update the existing one
                    conn.execute('''
                        INSERT INTO days (date, first_wake_at)
                        VALUES (?, ?)
                        ON CONFLICT(date) DO UPDATE SET first_wake_at = excluded.first_wake_at
                    ''', (today_str, timestamp))

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

        if event_type == 'sleep' and timestamp:
            today_str = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).strftime('%Y-%m-%d')
            app.logger.info(f"Received nighttime sleep event for {today_str} at {timestamp}")
            # Future logic: finalize today's schedule, calculate total awake time, etc.
            return {"status": "success", "message": "Nighttime sleep event received."}

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
                day_cursor = conn.execute('SELECT id FROM days WHERE date = ?', (today_str,))
                day_row = day_cursor.fetchone()
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

            # TODO: Add logic to adjust the rest of the day's schedule
            return {"status": "success", "message": f"Nap {nap_index} stop logged."}
        except sqlite3.Error as e:
            app.logger.error(f"Database error in stop_nap: {e}")
            return {"status": "error", "message": "Failed to log nap stop."}, 500
        finally:
            if conn:
                conn.close()

    return app
