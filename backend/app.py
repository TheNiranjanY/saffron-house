from restaurant import create_app
from restaurant.config import Config

app = create_app()

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=Config.FLASK_PORT,
        debug=Config.DEBUG,
        use_reloader=False,
    )
