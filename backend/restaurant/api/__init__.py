def register_blueprints(app):
    from .analytics import analytics_bp
    from .billing import billing_bp
    from .catalog import catalog_bp
    from .dining import dining_bp
    from .orders import orders_bp
    from .system import system_bp

    for blueprint in (
        system_bp,
        catalog_bp,
        dining_bp,
        orders_bp,
        billing_bp,
        analytics_bp,
    ):
        app.register_blueprint(blueprint)
