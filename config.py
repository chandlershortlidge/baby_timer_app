import os

# For local development, it's helpful to use a .env file to set environment variables.
# Create a file named .env in the root of your project and add:
# SECRET_KEY='a-long-random-secret-string'
#
# In production, these should be set directly in your deployment environment.
from dotenv import load_dotenv
load_dotenv()

class Config:
    """
    Application configuration settings.
    Best practice is to load sensitive values from environment variables.
    """
    # It's critical to set a secret key for session management and other security features.
    # You can generate a good key using: python -c 'import os; print(os.urandom(24))'
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'a-default-secret-key-for-dev-only'

    # Define the database file. It's good practice to store this in the
    # instance folder, which is not part of the version-controlled code.
    DATABASE = 'nap_plans.db'

    # Default lead time (in seconds) for upcoming nap alarms.
    DEFAULT_NAP_ALARM_LEAD_SEC = int(os.environ.get('DEFAULT_NAP_ALARM_LEAD_SEC', 20 * 60))

    # Default lead time for end-of-nap reminders.
    DEFAULT_NAP_END_REMINDER_LEAD_SEC = int(os.environ.get('DEFAULT_NAP_END_REMINDER_LEAD_SEC', 20 * 60))
