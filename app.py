import sqlite3
from datetime import datetime
from flask import Flask, flash, redirect, render_template, request, url_for

# Define the database file
DB_FILE = 'nap_plans.db'

def create_db():
    """
    Creates the SQLite database and the nap_plans table if they don't exist.
    """
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS nap_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            number_of_naps INTEGER,
            nap_durations TEXT,
            wake_time TEXT
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

    @app.route('/plan_naps', methods=['POST'])
    def plan_naps():
        """
        Handles POST requests to plan nap schedules.
        Validates form data and renders the plan confirmation.
        """
        date_str = request.form.get('date')
        num_naps_str = request.form.get('num_naps')

        if not date_str or not num_naps_str:
            flash("Please provide both a date and the number of naps.", "error")
            return redirect(url_for("index"))

        try:
            num_naps = int(num_naps_str)
            if num_naps < 1:
                raise ValueError()
        except ValueError:
            flash("Please enter a valid, positive number for naps.", "error")
            return redirect(url_for("index"))

        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            date = date_obj.strftime("%A, %B %d, %Y")
        except ValueError:
            flash("Please enter a valid date.", "error")
            return redirect(url_for("index"))

        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute(
                "INSERT INTO nap_plans (date, number_of_naps) VALUES (?, ?)",
                (date_str, num_naps),
            )
            conn.commit()
        finally:
            conn.close()

        flash(f"Successfully created a plan for {date} with {num_naps} nap(s).", "success")
        return redirect(url_for("index"))

    @app.route('/log_nap', methods=['POST'])
    def log_nap():
        """
        Handles POST requests to log nap events.
        For now, just prints the form data to the console.
        """
        data = request.json
        print("Received data from client:", data)
        # You would add code here to save to the database later
        return {"status": "success", "message": "Nap event logged successfully"}

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=True)
