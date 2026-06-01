"""
Flask API для модуля ФЛК.
Python 3.11 + Flask + psycopg2 + PostgreSQL 14.

Запуск:
    python app.py

Или через gunicorn:
    gunicorn -w 4 -b 0.0.0.0:5001 app:app
"""

import os
from dotenv import load_dotenv

# Загрузка .env перед импортом db (чтобы переменные были доступны)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from flask import Flask, request, jsonify
from flask_cors import CORS
import db

app = Flask(__name__)

# CORS: разрешаем запросы с фронтенда (Vite dev server на 5000)
CORS(app, resources={r"/api/*": {"origins": "*"}})


# ============================================================
# Middleware: обработка ошибок
# ============================================================

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"status": "error", "message": str(e)}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"status": "error", "message": "Не найдено"}), 404


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"status": "error", "message": "Внутренняя ошибка сервера"}), 500


# ============================================================
# API: Правила ФЛК
# ============================================================

@app.route("/api/v1/rules", methods=["GET"])
def list_rules():
    """GET /api/v1/rules — Список правил с фильтрами."""
    try:
        filters = {
            "owner_id": request.args.get("owner_id"),
            "incident_id": request.args.get("incident_id"),
            "status": request.args.get("status"),
            "search": request.args.get("search"),
        }
        # Убираем пустые фильтры
        filters = {k: v for k, v in filters.items() if v}

        rules = db.get_rules(filters if filters else None)
        return jsonify({"status": "success", "data": rules})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/v1/rules/<int:rule_id>", methods=["GET"])
def get_rule(rule_id):
    """GET /api/v1/rules/<id> — Одно правило."""
    try:
        rule = db.get_rule(rule_id)
        if rule is None:
            return jsonify({"status": "error", "message": "Правило не найдено"}), 404
        return jsonify({"status": "success", "data": rule})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/v1/rules", methods=["POST"])
def save_rule():
    """POST /api/v1/rules — UPSERT правила (INSERT / UPDATE)."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "Тело запроса пустое"}), 400

        # Валидация обязательных полей
        required = ["indicator", "incident_id", "incident_id_from_pm",
                     "product_type", "product_name", "indicator_category",
                     "check_type", "target_schema", "target_table",
                     "evaluation", "passing_criteria"]
        missing = [f for f in required if not data.get(f)]
        if missing:
            return jsonify({
                "status": "error",
                "message": f"Не заполнены обязательные поля: {', '.join(missing)}"
            }), 400

        rule = db.upsert_rule(data)
        return jsonify({"status": "success", "data": rule})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/v1/rules/<int:rule_id>", methods=["DELETE"])
def delete_rule(rule_id):
    """DELETE /api/v1/rules/<id> — Удаление правила."""
    try:
        deleted = db.delete_rule(rule_id)
        if not deleted:
            return jsonify({"status": "error", "message": "Правило не найдено"}), 404
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/v1/rules/test", methods=["POST"])
def test_rule():
    """POST /api/v1/rules/test — Тестовый прогон проверки."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "Тело запроса пустое"}), 400

        result = db.test_rule(data)
        return jsonify({"status": "success", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ============================================================
# API: Метаданные таблиц
# ============================================================

@app.route("/api/v1/metadata/tables", methods=["GET"])
def metadata_tables():
    """GET /api/v1/metadata/tables — Дерево схем/таблиц для sidebar."""
    try:
        metadata = db.get_table_metadata()
        return jsonify({"status": "success", "data": metadata})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ============================================================
# Healthcheck
# ============================================================

@app.route("/api/health", methods=["GET"])
def health():
    """Проверка доступности API и БД."""
    try:
        from db import get_connection
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return jsonify({"status": "ok", "database": "connected"})
    except Exception as e:
        return jsonify({"status": "error", "database": "disconnected", "message": str(e)}), 500


# ============================================================
# Инициализация
# ============================================================

if __name__ == "__main__":
    print("[app] Applying DDL...")
    try:
        db.init_db()
        print("[app] Database initialized")
    except Exception as e:
        print(f"[app] Warning: Could not init DB: {e}")
        print("[app] API will still start, but some features may not work.")

    port = int(os.getenv("FLASK_PORT", "5001"))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"

    print(f"[app] Starting Flask on port {port} (debug={debug})")
    app.run(host="0.0.0.0", port=port, debug=debug)
