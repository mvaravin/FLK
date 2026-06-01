-- ============================================================
-- DDL для модуля ФЛК (Форматно-логический контроль)
-- Применить к PostgreSQL 14+
-- ============================================================

-- Схема для технических таблиц (если ещё не создана)
CREATE SCHEMA IF NOT EXISTS tech_data;

-- ============================================================
-- 1. Основная таблица конфигурации правил ФЛК
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_config_table (
    id serial4 PRIMARY KEY,
    indicator varchar NOT NULL,
    description varchar NULL,
    incident_id varchar NOT NULL,
    incident_id_from_pm varchar NOT NULL,
    product_type varchar NOT NULL,
    product_name varchar NOT NULL,
    indicator_category varchar NOT NULL,
    check_type varchar NOT NULL,

    -- Целевая таблица (при обновлении которой триггерится правило)
    target_schema varchar NOT NULL,
    target_table varchar NOT NULL,

    -- Блок логики проверки
    check_mode varchar NOT NULL DEFAULT 'SIMPLE',  -- 'SIMPLE' или 'RAW_SQL'
    is_aggregated bool NOT NULL DEFAULT false,
    rule_payload jsonb NULL,
    raw_sql_template varchar NULL,

    -- Блок критериев
    evaluation varchar NOT NULL,
    passing_criteria float4 NOT NULL,
    is_actual bool DEFAULT true NOT NULL,

    -- Старый функционал Python/ETL (совместимость)
    is_custom bool DEFAULT false NOT NULL,
    custom_function varchar NULL,
    custom_function_args _varchar NULL,

    -- Ответственные
    pm_responsible_id varchar NULL,
    pm_accomplices_ids varchar NULL,

    -- Статус (для UI: DRAFT, PUBLISHED, ARCHIVED)
    status varchar NOT NULL DEFAULT 'DRAFT',

    update_timestamp timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Индексы для быстрой выборки
CREATE INDEX IF NOT EXISTS idx_flk_config_target
    ON tech_data.tech_flk_config_table (target_schema, target_table);
CREATE INDEX IF NOT EXISTS idx_flk_config_actual
    ON tech_data.tech_flk_config_table (is_actual);
CREATE INDEX IF NOT EXISTS idx_flk_config_responsible
    ON tech_data.tech_flk_config_table (pm_responsible_id);
CREATE INDEX IF NOT EXISTS idx_flk_config_status
    ON tech_data.tech_flk_config_table (status);

-- ============================================================
-- 2. Таблица очереди артефактов на проверку
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_artefacts_to_check (
    artefact_schema varchar NOT NULL,
    artefact_name varchar NOT NULL,
    check_carried_out bool DEFAULT false NOT NULL,
    last_checking_timestamp timestamp NULL,
    artefact_type varchar NOT NULL,
    CONSTRAINT tech_flk_artefacts_to_check_pk PRIMARY KEY (artefact_schema, artefact_name)
);

-- ============================================================
-- 3. Таблица результатов проверок
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_checks_results (
    id serial4 PRIMARY KEY,
    flk_id int4 NOT NULL REFERENCES tech_data.tech_flk_config_table(id),
    result bool NULL,
    final_query varchar NULL,
    error varchar NULL,
    check_timestamp timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flk_results_flk_id
    ON tech_data.tech_flk_checks_results (flk_id);

-- ============================================================
-- 4. Таблица логов времени выполнения проверок
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_working_time_of_checks_log (
    id serial4 PRIMARY KEY,
    check_id int4 NOT NULL,
    start_datetime timestamp NOT NULL,
    end_datetime timestamp NOT NULL,
    working_time float4 NOT NULL
);

-- ============================================================
-- 5. Конфигурация переноса DAL → QHL
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_dal_to_qhl_config (
    id serial4 PRIMARY KEY,
    dal_table varchar NOT NULL,
    qhl_table varchar NOT NULL,
    transfer_method varchar NOT NULL DEFAULT 'TRUNCATE'
);

-- ============================================================
-- 6. Лог переноса DAL → QHL
-- ============================================================
CREATE TABLE IF NOT EXISTS tech_data.tech_flk_dal_to_qhl_log (
    id serial4 PRIMARY KEY,
    dal_table varchar NOT NULL,
    qhl_table varchar NOT NULL,
    rows_number int4 DEFAULT 0,
    error varchar NULL,
    transfer_timestamp timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================================
-- 7. Функция генерации SQL-запроса из правила
-- ============================================================
CREATE OR REPLACE FUNCTION tech_data.tech_flk_create_checking_queries(r RECORD)
RETURNS varchar
LANGUAGE plpgsql
AS $function$
DECLARE
    final_query varchar;
    v_column varchar;
    v_operator varchar;
    v_value varchar;
    v_where varchar;
BEGIN
    IF r.check_mode = 'RAW_SQL' THEN
        final_query := REPLACE(r.raw_sql_template, '{schema}', r.target_schema);
        final_query := REPLACE(final_query, '{table}', r.target_table);

    ELSIF r.check_mode = 'SIMPLE' THEN
        v_column := r.rule_payload->>'column';
        v_operator := r.rule_payload->>'operator';
        v_value := r.rule_payload->>'value';
        v_where := r.rule_payload->>'where_clause';

        final_query := format(
            'SELECT CASE WHEN %s %s %s THEN true ELSE false END AS res FROM %I.%I',
            v_column, v_operator, v_value, r.target_schema, r.target_table
        );

        IF v_where IS NOT NULL AND trim(v_where) <> '' THEN
            final_query := final_query || ' WHERE ' || v_where;
        END IF;
    END IF;

    RETURN final_query;
END;
$function$;

-- ============================================================
-- 8. Функция проверки таблицы (ядро ФЛК)
-- ============================================================
CREATE OR REPLACE FUNCTION tech_data.tech_flk_check_table(p_table_schema character varying, p_table_name character varying)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    r RECORD;
    final_query VARCHAR;
    error VARCHAR;
    cnt_true NUMERIC;
    cnt_all NUMERIC;
    res BOOL;
    final_query_r RECORD;
    overall_res BOOL := true;
    start_datetime TIMESTAMP;
    end_datetime TIMESTAMP;
    v_result_queries VARCHAR[];
BEGIN
    FOR r IN
        SELECT *
        FROM tech_data.tech_flk_config_table
        WHERE target_schema = p_table_schema
          AND target_table = p_table_name
          AND is_actual = true
          AND COALESCE(LOWER(custom_function), '') NOT LIKE '%python%'
    LOOP
        start_datetime := clock_timestamp();
        error := NULL;
        res := NULL;

        IF r.is_custom THEN
            EXECUTE format('SELECT tech_data.%s(%L, false)', r.custom_function, ROW_TO_JSON(r)) INTO v_result_queries;
            IF v_result_queries[7] = 'true' THEN res := true;
            ELSIF v_result_queries[7] = 'false' THEN res := false;
            END IF;
            final_query := v_result_queries[5];
            error := v_result_queries[6];
        ELSE
            final_query := tech_data.tech_flk_create_checking_queries(r);

            BEGIN
                IF r.is_aggregated THEN
                    EXECUTE final_query INTO res;
                ELSE
                    cnt_true := 0;
                    cnt_all := 0;

                    FOR final_query_r IN EXECUTE final_query LOOP
                        cnt_all := cnt_all + 1;
                        IF final_query_r.res THEN
                            cnt_true := cnt_true + 1;
                        END IF;
                    END LOOP;

                    IF cnt_all > 0 THEN
                        res := (cnt_true / cnt_all) >= r.passing_criteria;
                    ELSE
                        res := true;
                    END IF;
                END IF;

            EXCEPTION WHEN others THEN
                error := SQLERRM;
            END;
        END IF;

        IF NOT res OR res IS NULL THEN
            overall_res := false;
        END IF;

        end_datetime := clock_timestamp();

        INSERT INTO tech_data.tech_flk_checks_results (flk_id, result, final_query, error)
        VALUES (r.id, res, final_query, error);

        INSERT INTO tech_data.tech_flk_working_time_of_checks_log (check_id, start_datetime, end_datetime, working_time)
        VALUES (r.id, start_datetime, end_datetime, extract(epoch from (end_datetime - start_datetime)));
    END LOOP;

    RETURN overall_res;
END;
$function$;

-- ============================================================
-- 9. Seed данные (опционально — для демонстрации)
-- ============================================================
INSERT INTO tech_data.tech_flk_config_table
    (indicator, description, incident_id, incident_id_from_pm, product_type, product_name,
     indicator_category, check_type, target_schema, target_table,
     check_mode, is_aggregated, rule_payload, raw_sql_template,
     evaluation, passing_criteria, is_actual, pm_responsible_id, pm_accomplices_ids, status)
VALUES
    ('Проверка суммы платежей', 'Все суммы платежей должны быть больше нуля',
     'И55 Очистные сооружения', 'PM-055', 'Аналитика', 'Платежная система',
     'Финансы', 'Построчная', 'dal_data', 'payments_table',
     'SIMPLE', false,
     '{"column": "amount", "operator": ">", "value": "0", "where_clause": "status = ''SUCCESS''"}'::jsonb,
     NULL, 'PERCENTAGE', 0.95, true, 'admin', NULL, 'PUBLISHED'),

    ('Проверка NOT NULL email', 'Email клиента не должен быть пустым',
     'И12 CRM модуль', 'PM-012', 'CRM', 'Клиентский модуль',
     'Качество данных', 'Построчная', 'dal_data', 'customers_table',
     'SIMPLE', false,
     '{"column": "email", "operator": "IS NOT NULL", "value": "", "where_clause": ""}'::jsonb,
     NULL, 'PERCENTAGE', 1.0, true, 'admin', 'ivanov_ii,petrov_pp', 'DRAFT'),

    ('Агрегатная проверка остатков', 'Итоговые остатки на складе не должны быть отрицательными',
     'И55 Очистные сооружения', 'PM-055', 'Логистика', 'Система складского учёта',
     'Логистика', 'Агрегатная', 'btl_data', 'warehouse_stock',
     'RAW_SQL', true, NULL,
     'SELECT CASE WHEN MIN(quantity) >= 0 THEN true ELSE false END AS res FROM {schema}.{table}',
     'BOOLEAN', 1.0, true, 'sidorov_ss', NULL, 'PUBLISHED'),

    ('Дубликаты в справочнике', 'Проверка уникальности записей в справочнике продуктов',
     'И12 CRM модуль', 'PM-012', 'Справочники', 'Мастер-данные',
     'Качество данных', 'Агрегатная', 'qhl_data', 'product_catalog',
     'RAW_SQL', true, NULL,
     'SELECT CASE WHEN COUNT(*) = COUNT(DISTINCT product_code) THEN true ELSE false END AS res FROM {schema}.{table}',
     'BOOLEAN', 1.0, true, 'ivanov_ii', 'admin', 'DRAFT'),

    ('Проверка дат отгрузки', 'Дата отгрузки не должна быть раньше даты заказа',
     'И55 Очистные сооружения', 'PM-055', 'Логистика', 'Система заказов',
     'Логистика', 'Построчная', 'dal_data', 'orders_table',
     'SIMPLE', false,
     '{"column": "ship_date", "operator": ">=", "value": "order_date", "where_clause": ""}'::jsonb,
     NULL, 'PERCENTAGE', 0.99, true, 'admin', NULL, 'ARCHIVED')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Готово. Все объекты созданы в схеме tech_data.
-- ============================================================
