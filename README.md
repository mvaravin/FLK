# Модуль ФЛК — Форматно-логический контроль данных

## Архитектура

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  React Frontend │────▶│  Express (Vite)  │────▶│  Flask API   │────▶  PostgreSQL 14
│  (TypeScript)   │     │  Port: 5000      │     │  Port: 5001  │
└─────────────────┘     └──────────────────┘     └──────────────┘
                              │                        │
                              │  Если Flask недоступен  │
                              └──── In-Memory (демо) ───┘
```

**Два режима работы:**
- **Демо-режим** — только Express с in-memory данными (Flask и PostgreSQL не нужны)
- **Полный режим** — Express проксирует на Flask → PostgreSQL

---

## Быстрый старт (демо-режим)

```bash
cd flk-module
npm install
npm run dev
```

Открыть http://localhost:5000 — приложение работает с тестовыми данными в памяти.

---

## Полный режим (Flask + PostgreSQL)

### 1. Подготовка PostgreSQL

Создайте базу данных и примените DDL:

```bash
psql -U postgres -d your_database -f flask_backend/ddl.sql
```

Это создаст:
- Схему `tech_data`
- Таблицу `tech_flk_config_table` (с JSONB, индексами)
- Таблицы очереди и логов
- Функции `tech_flk_create_checking_queries` и `tech_flk_check_table`
- 5 тестовых правил

### 2. Настройка Flask

```bash
cd flask_backend

# Создайте .env из примера
cp .env.example .env

# Заполните параметры подключения к PostgreSQL
# nano .env
```

Содержимое `.env`:
```
PG_HOST=localhost
PG_PORT=5432
PG_DBNAME=your_database_name
PG_USER=postgres
PG_PASSWORD=your_password
FLASK_PORT=5001
FLASK_DEBUG=true
```

### 3. Установка зависимостей Python

```bash
pip install -r requirements.txt
```

### 4. Запуск Flask

```bash
python app.py
```

Flask стартует на порту 5001. При запуске автоматически применяет DDL (идемпотентно).

### 5. Запуск фронтенда

В отдельном терминале:
```bash
cd ..  # корень flk-module
npm run dev
```

Express обнаружит Flask на порту 5001 и начнёт проксировать API-запросы.

---

## API эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/v1/rules` | Список правил (query: owner_id, incident_id, status, search) |
| GET | `/api/v1/rules/:id` | Одно правило |
| POST | `/api/v1/rules` | UPSERT — создание/обновление |
| DELETE | `/api/v1/rules/:id` | Удаление правила |
| POST | `/api/v1/rules/test` | Тестовый прогон (выполняет SQL в БД) |
| GET | `/api/v1/metadata/tables` | Дерево схем и таблиц |
| GET | `/api/health` | Healthcheck (Flask) |

---

## Технологический стек

- **Frontend:** React 18, TypeScript, Tailwind CSS, shadcn/ui, Vite
- **Backend (Node):** Express 5 — обслуживает Vite HMR + проксирует на Flask
- **Backend (Python):** Flask 3.1, psycopg2, Python 3.11
- **Database:** PostgreSQL 14.17

---

## Структура проекта

```
flk-module/
├── client/src/
│   ├── pages/
│   │   ├── catalog.tsx        # Каталог (маркетплейс карточек)
│   │   └── rule-edit.tsx      # Редактор правила (Split-View)
│   ├── components/ui/         # shadcn/ui компоненты
│   └── App.tsx                # Маршрутизация
│
├── server/
│   ├── routes.ts              # Express API (проксирование на Flask)
│   └── storage.ts             # In-memory хранилище (фоллбэк)
│
├── flask_backend/
│   ├── app.py                 # Flask-приложение
│   ├── db.py                  # Слой работы с PostgreSQL
│   ├── ddl.sql                # DDL: все таблицы, функции, seed-данные
│   ├── requirements.txt       # Python-зависимости
│   └── .env.example           # Шаблон конфигурации
│
└── shared/schema.ts           # Общие типы TypeScript
```

---

## Заглушки и ограничения

- **Авторизация:** `user_id = 'admin'` (заглушка). В продакшене подключить вашу систему аутентификации.
- **Дерево таблиц:** В полном режиме загружается из `information_schema`. Если нужных схем нет — используется статический фоллбэк.
- **Тестовый прогон:** В полном режиме реально выполняет SQL. В демо — имитация.
