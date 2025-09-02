import os
import tempfile

import pytest
from baby_timer_app.app import create_app, get_db_connection


@pytest.fixture
def app():
    """Create and configure a new app instance for each test."""
    # Create a temporary file to isolate the database for each test
    db_fd, db_path = tempfile.mkstemp()

    # Create the app with a test-specific configuration
    app = create_app({
        'TESTING': True,
        # Override the DATABASE config to use the temporary file's path.
        'DATABASE': db_path,
    })

    # The create_app factory already calls create_db, so the temp
    # database is set up. We don't need to call it again.

    yield app

    # Clean up after the test by closing and removing the temporary file
    os.close(db_fd)
    os.unlink(db_path)

@pytest.fixture
def client(app):
    """A test client for the app."""
    return app.test_client()