import sqlite3
from datetime import datetime
from flask import Flask, flash, redirect, render_template, request, url_for

# Define the database file
DB_FILE = 'nap_plans.db'

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
    # A secret key is required to use flash messages.
    # In production, this should be a long, random, secret value.
    app.secret_key = "dev"
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
        Fetches the complete schedule for the current day.
        (Implementation to follow)
        """
        # Placeholder response
        return {"message": "Endpoint for getting today's schedule"}

    @app.route('/api/day/bedtime', methods=['POST'])
    def log_bedtime():
        """
        Logs the start of nighttime sleep or the morning wake-up ('firstWakeAt').
        """
        data = request.json
        event_type = data.get('type')
        timestamp = data.get('timestamp')

        if event_type == 'wake' and timestamp:
            today_str = datetime.now().strftime('%Y-%m-%d')
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                # Use "UPSERT" to either insert a new day or update the existing one
                c.execute('''
                    INSERT INTO days (date, first_wake_at)
                    VALUES (?, ?)
                    ON CONFLICT(date) DO UPDATE SET first_wake_at = excluded.first_wake_at
                ''', (today_str, timestamp))
                conn.commit()
                return {"status": "success", "message": f"Wake time for {today_str} logged as {timestamp}."}
            except sqlite3.Error as e:
                print(f"Database error: {e}")
                return {"status": "error", "message": "Failed to log wake time."}, 500
            finally:
                if conn:
                    conn.close()
        
        # Placeholder for 'sleep' event type
        return {"status": "success", "message": "Bedtime event received."}

    @app.route('/api/naps/start', methods=['POST'])
    def start_nap():
        """Logs the start of a specific nap."""
        data = request.json
        print(f"Received start nap event for index: {data.get('index')}")
        return {"status": "success", "message": "Nap start logged"}

    @app.route('/api/naps/stop', methods=['POST'])
    def stop_nap():
        """Logs the end of a nap and triggers schedule adjustment logic."""
        data = request.json
        print(f"Received stop nap event for index: {data.get('index')}")
        return {"status": "success", "message": "Nap stop logged"}

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)
