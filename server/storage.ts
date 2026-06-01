import { type FlkRule, type InsertFlkRule, type TableMetadata } from "@shared/schema";

export interface IStorage {
  getRules(filters?: { owner_id?: string; incident_id?: string; status?: string; search?: string }): Promise<FlkRule[]>;
  getRule(id: number): Promise<FlkRule | undefined>;
  upsertRule(rule: InsertFlkRule & { id?: number | null }): Promise<FlkRule>;
  deleteRule(id: number): Promise<boolean>;
  getTableMetadata(): Promise<TableMetadata[]>;
}

export class MemStorage implements IStorage {
  private rules: Map<number, FlkRule>;
  private nextId: number;

  constructor() {
    this.rules = new Map();
    this.nextId = 1;
    this.seedData();
  }

  private seedData() {
    const seed: Omit<FlkRule, "id" | "update_timestamp">[] = [
      {
        indicator: "Проверка суммы платежей",
        description: "Все суммы платежей должны быть больше нуля",
        incident_id: "И55 Очистные сооружения",
        incident_id_from_pm: "PM-055",
        product_type: "Аналитика",
        product_name: "Платежная система",
        indicator_category: "Финансы",
        check_type: "Построчная",
        target_schema: "dal_data",
        target_table: "payments_table",
        check_mode: "SIMPLE",
        is_aggregated: false,
        rule_payload: { column: "amount", operator: ">", value: "0", where_clause: "status = 'SUCCESS'" },
        raw_sql_template: null,
        evaluation: "PERCENTAGE",
        passing_criteria: 0.95,
        is_actual: true,
        is_custom: false,
        custom_function: null,
        pm_responsible_id: "admin",
        pm_accomplices_ids: null,
        status: "PUBLISHED",
      },
      {
        indicator: "Проверка NOT NULL email",
        description: "Email клиента не должен быть пустым",
        incident_id: "И12 CRM модуль",
        incident_id_from_pm: "PM-012",
        product_type: "CRM",
        product_name: "Клиентский модуль",
        indicator_category: "Качество данных",
        check_type: "Построчная",
        target_schema: "dal_data",
        target_table: "customers_table",
        check_mode: "SIMPLE",
        is_aggregated: false,
        rule_payload: { column: "email", operator: "IS NOT NULL", value: "", where_clause: "" },
        raw_sql_template: null,
        evaluation: "PERCENTAGE",
        passing_criteria: 1.0,
        is_actual: true,
        is_custom: false,
        custom_function: null,
        pm_responsible_id: "admin",
        pm_accomplices_ids: "ivanov_ii,petrov_pp",
        status: "DRAFT",
      },
      {
        indicator: "Агрегатная проверка остатков",
        description: "Итоговые остатки на складе не должны быть отрицательными",
        incident_id: "И55 Очистные сооружения",
        incident_id_from_pm: "PM-055",
        product_type: "Логистика",
        product_name: "Система складского учёта",
        indicator_category: "Логистика",
        check_type: "Агрегатная",
        target_schema: "btl_data",
        target_table: "warehouse_stock",
        check_mode: "RAW_SQL",
        is_aggregated: true,
        rule_payload: null,
        raw_sql_template: "SELECT CASE WHEN MIN(quantity) >= 0 THEN true ELSE false END AS res FROM {schema}.{table}",
        evaluation: "BOOLEAN",
        passing_criteria: 1.0,
        is_actual: true,
        is_custom: false,
        custom_function: null,
        pm_responsible_id: "sidorov_ss",
        pm_accomplices_ids: null,
        status: "PUBLISHED",
      },
      {
        indicator: "Дубликаты в справочнике",
        description: "Проверка уникальности записей в справочнике продуктов",
        incident_id: "И12 CRM модуль",
        incident_id_from_pm: "PM-012",
        product_type: "Справочники",
        product_name: "Мастер-данные",
        indicator_category: "Качество данных",
        check_type: "Агрегатная",
        target_schema: "qhl_data",
        target_table: "product_catalog",
        check_mode: "RAW_SQL",
        is_aggregated: true,
        rule_payload: null,
        raw_sql_template: "SELECT CASE WHEN COUNT(*) = COUNT(DISTINCT product_code) THEN true ELSE false END AS res FROM {schema}.{table}",
        evaluation: "BOOLEAN",
        passing_criteria: 1.0,
        is_actual: true,
        is_custom: false,
        custom_function: null,
        pm_responsible_id: "ivanov_ii",
        pm_accomplices_ids: "admin",
        status: "DRAFT",
      },
      {
        indicator: "Проверка дат отгрузки",
        description: "Дата отгрузки не должна быть раньше даты заказа",
        incident_id: "И55 Очистные сооружения",
        incident_id_from_pm: "PM-055",
        product_type: "Логистика",
        product_name: "Система заказов",
        indicator_category: "Логистика",
        check_type: "Построчная",
        target_schema: "dal_data",
        target_table: "orders_table",
        check_mode: "SIMPLE",
        is_aggregated: false,
        rule_payload: { column: "ship_date", operator: ">=", value: "order_date", where_clause: "" },
        raw_sql_template: null,
        evaluation: "PERCENTAGE",
        passing_criteria: 0.99,
        is_actual: true,
        is_custom: false,
        custom_function: null,
        pm_responsible_id: "admin",
        pm_accomplices_ids: null,
        status: "ARCHIVED",
      },
    ];

    for (const item of seed) {
      const id = this.nextId++;
      this.rules.set(id, {
        ...item,
        id,
        update_timestamp: new Date(),
      });
    }
  }

  async getRules(filters?: { owner_id?: string; incident_id?: string; status?: string; search?: string }): Promise<FlkRule[]> {
    let rules = Array.from(this.rules.values());

    if (filters?.owner_id) {
      rules = rules.filter(r => r.pm_responsible_id === filters.owner_id || (r.pm_accomplices_ids && r.pm_accomplices_ids.includes(filters.owner_id!)));
    }
    if (filters?.incident_id) {
      rules = rules.filter(r => r.incident_id === filters.incident_id);
    }
    if (filters?.status) {
      rules = rules.filter(r => r.status === filters.status);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      rules = rules.filter(r =>
        r.indicator.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q))
      );
    }

    return rules.sort((a, b) => b.update_timestamp.getTime() - a.update_timestamp.getTime());
  }

  async getRule(id: number): Promise<FlkRule | undefined> {
    return this.rules.get(id);
  }

  async upsertRule(rule: InsertFlkRule & { id?: number | null }): Promise<FlkRule> {
    if (rule.id && this.rules.has(rule.id)) {
      const existing = this.rules.get(rule.id)!;
      const updated: FlkRule = {
        ...existing,
        ...rule,
        id: existing.id,
        update_timestamp: new Date(),
      };
      this.rules.set(existing.id, updated);
      return updated;
    }

    const id = this.nextId++;
    const newRule: FlkRule = {
      indicator: rule.indicator,
      description: rule.description ?? null,
      incident_id: rule.incident_id,
      incident_id_from_pm: rule.incident_id_from_pm,
      product_type: rule.product_type,
      product_name: rule.product_name,
      indicator_category: rule.indicator_category,
      check_type: rule.check_type,
      target_schema: rule.target_schema,
      target_table: rule.target_table,
      check_mode: rule.check_mode ?? "SIMPLE",
      is_aggregated: rule.is_aggregated ?? false,
      rule_payload: rule.rule_payload ?? null,
      raw_sql_template: rule.raw_sql_template ?? null,
      evaluation: rule.evaluation,
      passing_criteria: rule.passing_criteria,
      is_actual: rule.is_actual ?? true,
      is_custom: rule.is_custom ?? false,
      custom_function: rule.custom_function ?? null,
      pm_responsible_id: rule.pm_responsible_id ?? null,
      pm_accomplices_ids: rule.pm_accomplices_ids ?? null,
      status: rule.status ?? "DRAFT",
      id,
      update_timestamp: new Date(),
    };
    this.rules.set(id, newRule);
    return newRule;
  }

  async deleteRule(id: number): Promise<boolean> {
    return this.rules.delete(id);
  }

  async getTableMetadata(): Promise<TableMetadata[]> {
    return [
      {
        schema: "dal_data",
        tables: [
          { name: "payments_table", columns: ["id", "amount", "currency", "status", "created_at", "customer_id"] },
          { name: "customers_table", columns: ["id", "name", "email", "phone", "region", "created_at"] },
          { name: "orders_table", columns: ["id", "order_date", "ship_date", "total", "status", "customer_id"] },
          { name: "transactions_log", columns: ["id", "tx_type", "amount", "timestamp", "account_id"] },
        ],
      },
      {
        schema: "btl_data",
        tables: [
          { name: "warehouse_stock", columns: ["id", "product_code", "quantity", "warehouse_id", "last_update"] },
          { name: "supply_chain", columns: ["id", "supplier_id", "delivery_date", "items_count", "status"] },
        ],
      },
      {
        schema: "qhl_data",
        tables: [
          { name: "product_catalog", columns: ["id", "product_code", "name", "category", "price", "is_active"] },
          { name: "employee_directory", columns: ["id", "full_name", "department", "position", "hire_date"] },
        ],
      },
    ];
  }
}

export const storage = new MemStorage();
