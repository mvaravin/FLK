import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ArrowLeft, Save, Play, Send, ChevronRight, ChevronDown,
  Database, Table2, Search, Loader2, CheckCircle2, XCircle,
  FileText, Code2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FlkRule, TableMetadata, RulePayload } from "@shared/schema";

const CURRENT_USER = "admin";

const OPERATORS = ["=", "!=", ">", "<", ">=", "<=", "IS NULL", "IS NOT NULL", "LIKE", "IN"];

interface RuleFormState {
  id: number | null;
  indicator: string;
  description: string;
  incident_id: string;
  incident_id_from_pm: string;
  product_type: string;
  product_name: string;
  indicator_category: string;
  check_type: string;
  target_schema: string;
  target_table: string;
  check_mode: "SIMPLE" | "RAW_SQL";
  is_aggregated: boolean;
  rule_payload: RulePayload;
  raw_sql_template: string;
  evaluation: string;
  passing_criteria: number;
  is_actual: boolean;
  pm_responsible_id: string;
  pm_accomplices_ids: string;
  status: string;
}

const EMPTY_STATE: RuleFormState = {
  id: null,
  indicator: "",
  description: "",
  incident_id: "",
  incident_id_from_pm: "",
  product_type: "",
  product_name: "",
  indicator_category: "",
  check_type: "Построчная",
  target_schema: "",
  target_table: "",
  check_mode: "SIMPLE",
  is_aggregated: false,
  rule_payload: { column: "", operator: "=", value: "", where_clause: "" },
  raw_sql_template: "",
  evaluation: "PERCENTAGE",
  passing_criteria: 0.95,
  is_actual: true,
  pm_responsible_id: CURRENT_USER,
  pm_accomplices_ids: "",
  status: "DRAFT",
};

export default function RuleEditPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const isNew = params.id === "new";
  const ruleId = isNew ? null : parseInt(params.id!, 10);

  const [form, setForm] = useState<RuleFormState>(EMPTY_STATE);
  const [treeSearch, setTreeSearch] = useState("");
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<null | { passed: boolean; percentage: number; rows_checked: number; rows_passed: number; executed_query: string }>(null);

  // Загрузка правила
  const { data: ruleData, isLoading: ruleLoading } = useQuery<{ status: string; data: FlkRule }>({
    queryKey: ["/api/v1/rules", ruleId],
    enabled: !!ruleId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/v1/rules/${ruleId}`);
      return res.json();
    },
  });

  // Загрузка метаданных таблиц
  const { data: metaData } = useQuery<{ status: string; data: TableMetadata[] }>({
    queryKey: ["/api/v1/metadata/tables"],
  });

  const metadata = metaData?.data ?? [];

  // Подгрузка правила в форму
  useEffect(() => {
    if (ruleData?.data) {
      const r = ruleData.data;
      setForm({
        id: r.id,
        indicator: r.indicator,
        description: r.description ?? "",
        incident_id: r.incident_id,
        incident_id_from_pm: r.incident_id_from_pm,
        product_type: r.product_type,
        product_name: r.product_name,
        indicator_category: r.indicator_category,
        check_type: r.check_type,
        target_schema: r.target_schema,
        target_table: r.target_table,
        check_mode: r.check_mode as "SIMPLE" | "RAW_SQL",
        is_aggregated: r.is_aggregated,
        rule_payload: (r.rule_payload as RulePayload) ?? { column: "", operator: "=", value: "", where_clause: "" },
        raw_sql_template: r.raw_sql_template ?? "",
        evaluation: r.evaluation,
        passing_criteria: r.passing_criteria,
        is_actual: r.is_actual,
        pm_responsible_id: r.pm_responsible_id ?? "",
        pm_accomplices_ids: r.pm_accomplices_ids ?? "",
        status: r.status,
      });
      if (r.target_schema) {
        setOpenSchemas(new Set([r.target_schema]));
      }
    }
  }, [ruleData]);

  // RBAC: read-only если не владелец
  const isOwner = isNew ||
    form.pm_responsible_id === CURRENT_USER ||
    (form.pm_accomplices_ids && form.pm_accomplices_ids.includes(CURRENT_USER));
  const readOnly = !isOwner;

  // Колонки выбранной таблицы
  const selectedTableColumns = useMemo(() => {
    if (!form.target_schema || !form.target_table) return [];
    const schema = metadata.find((m) => m.schema === form.target_schema);
    const table = schema?.tables.find((t) => t.name === form.target_table);
    return table?.columns ?? [];
  }, [form.target_schema, form.target_table, metadata]);

  // Фильтрация дерева
  const filteredMetadata = useMemo(() => {
    if (!treeSearch) return metadata;
    const q = treeSearch.toLowerCase();
    return metadata
      .map((s) => ({
        ...s,
        tables: s.tables.filter((t) => t.name.toLowerCase().includes(q)),
      }))
      .filter((s) => s.tables.length > 0);
  }, [metadata, treeSearch]);

  // Мутация сохранения
  const saveMutation = useMutation({
    mutationFn: async (data: RuleFormState) => {
      const payload: any = {
        ...data,
        rule_payload: data.check_mode === "SIMPLE" ? data.rule_payload : null,
        raw_sql_template: data.check_mode === "RAW_SQL" ? data.raw_sql_template : null,
      };
      if (data.id === null) delete payload.id;
      const res = await apiRequest("POST", "/api/v1/rules", payload);
      return res.json();
    },
    onSuccess: (response) => {
      const newId = response.data.id;
      queryClient.invalidateQueries({ queryKey: ["/api/v1/rules"] });
      toast({ title: "Правило сохранено" });
      if (isNew) {
        navigate(`/rule/${newId}`);
      }
      setForm((f) => ({ ...f, id: newId }));
    },
    onError: () => {
      toast({ title: "Ошибка сохранения", variant: "destructive" });
    },
  });

  // Мутация теста
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/v1/rules/test", form);
      return res.json();
    },
    onSuccess: (response) => {
      setTestResult(response.data);
    },
    onError: () => {
      toast({ title: "Ошибка тестирования", variant: "destructive" });
    },
  });

  const handlePublish = () => {
    saveMutation.mutate({ ...form, status: "PUBLISHED" });
  };

  const update = (key: keyof RuleFormState, value: any) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const updatePayload = (key: keyof RulePayload, value: string) => {
    setForm((f) => ({
      ...f,
      rule_payload: { ...f.rule_payload, [key]: value },
    }));
  };

  const handleSelectTable = (schema: string, table: string) => {
    if (readOnly) return;
    setForm((f) => ({ ...f, target_schema: schema, target_table: table }));
  };

  if (ruleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <input
                className="text-base font-semibold bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
                value={form.indicator}
                onChange={(e) => update("indicator", e.target.value)}
                placeholder="Название проверки..."
                disabled={readOnly}
                data-testid="input-indicator"
              />
              <input
                className="text-xs text-muted-foreground bg-transparent border-none outline-none w-full placeholder:text-muted-foreground mt-0.5"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Описание..."
                disabled={readOnly}
                data-testid="input-description"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <Badge variant={form.status === "PUBLISHED" ? "default" : "secondary"} className="text-xs">
              {form.status === "PUBLISHED" ? "Опубликовано" : form.status === "ARCHIVED" ? "В архиве" : "Черновик"}
            </Badge>

            {!readOnly && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !form.target_table}
                  data-testid="button-test"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-1.5" />
                  )}
                  Тест
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePublish}
                  disabled={saveMutation.isPending}
                  data-testid="button-publish"
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  Опубликовать
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate(form)}
                  disabled={saveMutation.isPending || !form.indicator}
                  data-testid="button-save"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1.5" />
                  )}
                  Сохранить
                </Button>
              </>
            )}

            {readOnly && (
              <Badge variant="outline" className="text-xs text-amber-600">
                Только чтение
              </Badge>
            )}
          </div>
        </div>

        {/* Результат теста */}
        {testResult && (
          <div className={`mt-3 p-3 rounded-md text-sm border ${testResult.passed ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800" : "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"}`}>
            <div className="flex items-center gap-2">
              {testResult.passed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              <span className="font-medium">{testResult.passed ? "Тест пройден" : "Тест не пройден"}</span>
              <span className="text-muted-foreground">
                — {testResult.rows_passed}/{testResult.rows_checked} строк ({(testResult.percentage * 100).toFixed(1)}%)
              </span>
            </div>
            <code className="block mt-2 text-xs text-muted-foreground font-mono break-all">{testResult.executed_query}</code>
          </div>
        )}
      </header>

      {/* Split View */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Дерево таблиц */}
        <aside className="w-72 border-r border-border bg-card/30 flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Источники данных</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Поиск таблиц..."
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-tree-search"
              />
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2">
              {filteredMetadata.map((schema) => {
                const isOpen = openSchemas.has(schema.schema) || !!treeSearch;
                return (
                  <Collapsible
                    key={schema.schema}
                    open={isOpen}
                    onOpenChange={(open) => {
                      setOpenSchemas((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(schema.schema);
                        else next.delete(schema.schema);
                        return next;
                      });
                    }}
                  >
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md hover:bg-accent text-sm font-medium text-foreground">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <Database className="w-3.5 h-3.5 text-primary" />
                      {schema.schema}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-4 mt-0.5">
                        {schema.tables.map((table) => {
                          const isSelected = form.target_schema === schema.schema && form.target_table === table.name;
                          return (
                            <button
                              key={table.name}
                              onClick={() => handleSelectTable(schema.schema, table.name)}
                              disabled={readOnly}
                              className={`flex items-center gap-1.5 w-full px-2 py-1 rounded text-sm transition-colors text-left ${
                                isSelected
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
                              } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                              data-testid={`button-table-${schema.schema}-${table.name}`}
                            >
                              <Table2 className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{table.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>

          {/* Выбранная таблица */}
          {form.target_table && (
            <div className="p-3 border-t border-border bg-primary/5">
              <p className="text-xs text-muted-foreground mb-1">Выбрана:</p>
              <p className="text-sm font-medium text-primary truncate" data-testid="text-selected-table">
                {form.target_schema}.{form.target_table}
              </p>
            </div>
          )}
        </aside>

        {/* Right Workspace */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Метаданные правила */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div>
              <Label className="text-xs text-muted-foreground">Инцидент / Проект</Label>
              <Input
                value={form.incident_id}
                onChange={(e) => update("incident_id", e.target.value)}
                disabled={readOnly}
                placeholder="Напр.: И55 Очистные сооружения"
                className="mt-1"
                data-testid="input-incident-id"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">ID из PM</Label>
              <Input
                value={form.incident_id_from_pm}
                onChange={(e) => update("incident_id_from_pm", e.target.value)}
                disabled={readOnly}
                placeholder="PM-055"
                className="mt-1"
                data-testid="input-pm-id"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Тип продукта</Label>
              <Input
                value={form.product_type}
                onChange={(e) => update("product_type", e.target.value)}
                disabled={readOnly}
                placeholder="Аналитика"
                className="mt-1"
                data-testid="input-product-type"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Название продукта</Label>
              <Input
                value={form.product_name}
                onChange={(e) => update("product_name", e.target.value)}
                disabled={readOnly}
                placeholder="Платёжная система"
                className="mt-1"
                data-testid="input-product-name"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Категория</Label>
              <Input
                value={form.indicator_category}
                onChange={(e) => update("indicator_category", e.target.value)}
                disabled={readOnly}
                placeholder="Финансы"
                className="mt-1"
                data-testid="input-category"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Ответственный</Label>
              <Input
                value={form.pm_responsible_id}
                onChange={(e) => update("pm_responsible_id", e.target.value)}
                disabled={readOnly}
                placeholder="user_id"
                className="mt-1"
                data-testid="input-responsible"
              />
            </div>
          </div>

          {/* Режим проверки: вкладки */}
          <Tabs
            value={form.check_mode}
            onValueChange={(v) => !readOnly && update("check_mode", v)}
            className="mb-6"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="SIMPLE" disabled={readOnly} data-testid="tab-simple">
                <FileText className="w-4 h-4 mr-1.5" />
                Простой режим
              </TabsTrigger>
              <TabsTrigger value="RAW_SQL" disabled={readOnly} data-testid="tab-raw-sql">
                <Code2 className="w-4 h-4 mr-1.5" />
                SQL-режим
              </TabsTrigger>
            </TabsList>

            {/* SIMPLE Mode */}
            <TabsContent value="SIMPLE">
              <div className="space-y-5 rounded-lg border border-border p-5 bg-card/50">
                <div>
                  <Label className="text-sm font-medium mb-3 block">Условие проверки</Label>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[180px] flex-1">
                      <Label className="text-xs text-muted-foreground">Колонка</Label>
                      <Select
                        value={form.rule_payload.column || ""}
                        onValueChange={(v) => updatePayload("column", v)}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="mt-1" data-testid="select-column">
                          <SelectValue placeholder="Выберите колонку" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedTableColumns.length > 0 ? (
                            selectedTableColumns.map((col) => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))
                          ) : (
                            <SelectItem value="_none" disabled>Сначала выберите таблицу</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-[140px]">
                      <Label className="text-xs text-muted-foreground">Оператор</Label>
                      <Select
                        value={form.rule_payload.operator || "="}
                        onValueChange={(v) => updatePayload("operator", v)}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="mt-1" data-testid="select-operator">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map((op) => (
                            <SelectItem key={op} value={op}>{op}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-[160px] flex-1">
                      <Label className="text-xs text-muted-foreground">Значение</Label>
                      <Input
                        value={form.rule_payload.value || ""}
                        onChange={(e) => updatePayload("value", e.target.value)}
                        disabled={readOnly || form.rule_payload.operator === "IS NULL" || form.rule_payload.operator === "IS NOT NULL"}
                        placeholder="0"
                        className="mt-1"
                        data-testid="input-value"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">Фильтр данных (WHERE)</Label>
                  <Input
                    value={form.rule_payload.where_clause || ""}
                    onChange={(e) => updatePayload("where_clause", e.target.value)}
                    disabled={readOnly}
                    placeholder="status = 'ACTIVE' AND amount > 0"
                    className="font-mono text-sm"
                    data-testid="input-where"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Опционально. SQL-условие для фильтрации строк перед проверкой.
                  </p>
                </div>

                <div className="max-w-xs">
                  <Label className="text-sm font-medium mb-2 block">Критерий прохождения</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={form.passing_criteria}
                      onChange={(e) => update("passing_criteria", parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="w-24"
                      data-testid="input-criteria"
                    />
                    <span className="text-sm text-muted-foreground">
                      ({(form.passing_criteria * 100).toFixed(0)}% строк должны пройти)
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* RAW_SQL Mode */}
            <TabsContent value="RAW_SQL">
              <div className="space-y-5 rounded-lg border border-border p-5 bg-card/50">
                <div>
                  <Label className="text-sm font-medium mb-2 block">SQL-запрос</Label>
                  <Textarea
                    value={form.raw_sql_template}
                    onChange={(e) => update("raw_sql_template", e.target.value)}
                    disabled={readOnly}
                    placeholder={"SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END AS res\nFROM {schema}.{table}\nWHERE amount > 0"}
                    rows={8}
                    className="font-mono text-sm"
                    data-testid="input-raw-sql"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Используйте макросы <code className="bg-muted px-1 rounded">{"{schema}"}</code> и <code className="bg-muted px-1 rounded">{"{table}"}</code>, чтобы запрос был универсальным.
                  </p>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={form.is_aggregated}
                    onCheckedChange={(v) => update("is_aggregated", !!v)}
                    disabled={readOnly}
                    data-testid="checkbox-aggregated"
                  />
                  <span className="text-sm">Запрос возвращает 1 агрегированную строку (True/False)</span>
                </label>

                <div className="max-w-xs">
                  <Label className="text-sm font-medium mb-2 block">Критерий прохождения</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={form.passing_criteria}
                      onChange={(e) => update("passing_criteria", parseFloat(e.target.value) || 0)}
                      disabled={readOnly}
                      className="w-24"
                      data-testid="input-criteria-sql"
                    />
                    <span className="text-sm text-muted-foreground">
                      ({(form.passing_criteria * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
