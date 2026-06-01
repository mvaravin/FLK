import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, MoreVertical, FileText, CheckCircle2, Archive, Copy, Trash2, Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FlkRule } from "@shared/schema";

const CURRENT_USER = "admin";

const STATUS_MAP: Record<string, { label: string; icon: typeof FileText; className: string }> = {
  DRAFT: { label: "Черновик", icon: FileText, className: "text-amber-600 dark:text-amber-400" },
  PUBLISHED: { label: "Опубликовано", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  ARCHIVED: { label: "В архиве", icon: Archive, className: "text-muted-foreground" },
};

export default function CatalogPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showMine, setShowMine] = useState(true);
  const [showOthers, setShowOthers] = useState(true);
  const [incidentFilter, setIncidentFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ status: string; data: FlkRule[] }>({
    queryKey: ["/api/v1/rules"],
  });

  const rules = data?.data ?? [];

  // Фильтрация на клиенте
  const filtered = rules.filter((r) => {
    const isMine = r.pm_responsible_id === CURRENT_USER || (r.pm_accomplices_ids && r.pm_accomplices_ids.includes(CURRENT_USER));
    if (!showMine && isMine) return false;
    if (!showOthers && !isMine) return false;
    if (incidentFilter !== "all" && r.incident_id !== incidentFilter) return false;
    if (productFilter !== "all" && r.product_type !== productFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.indicator.toLowerCase().includes(q) && !(r.description && r.description.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const incidents = [...new Set(rules.map((r) => r.incident_id))];
  const products = [...new Set(rules.map((r) => r.product_type))];

  const handleDuplicate = async (rule: FlkRule) => {
    try {
      const { id, update_timestamp, ...rest } = rule;
      await apiRequest("POST", "/api/v1/rules", {
        ...rest,
        indicator: `${rest.indicator} (копия)`,
        status: "DRAFT",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/rules"] });
      toast({ title: "Правило продублировано" });
    } catch {
      toast({ title: "Ошибка дублирования", variant: "destructive" });
    }
  };

  const handleArchive = async (rule: FlkRule) => {
    try {
      await apiRequest("POST", "/api/v1/rules", { ...rule, status: "ARCHIVED" });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/rules"] });
      toast({ title: "Правило перемещено в архив" });
    } catch {
      toast({ title: "Ошибка", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/v1/rules/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/v1/rules"] });
      toast({ title: "Правило удалено" });
    } catch {
      toast({ title: "Ошибка удаления", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="text-page-title">
                Каталог проверок ФЛК
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Форматно-логический контроль данных
              </p>
            </div>
            <Button onClick={() => navigate("/rule/new")} data-testid="button-create-rule">
              <Plus className="w-4 h-4 mr-2" />
              Создать
            </Button>
          </div>

          {/* Фильтры */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию или описанию..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={showMine}
                  onCheckedChange={(v) => setShowMine(!!v)}
                  data-testid="checkbox-mine"
                />
                <span>Мои проверки</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={showOthers}
                  onCheckedChange={(v) => setShowOthers(!!v)}
                  data-testid="checkbox-others"
                />
                <span>Другие</span>
              </label>
            </div>

            <Select value={incidentFilter} onValueChange={setIncidentFilter}>
              <SelectTrigger className="w-[220px]" data-testid="select-incident">
                <SelectValue placeholder="Инцидент" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все инциденты</SelectItem>
                {incidents.map((i) => (
                  <SelectItem key={i} value={i}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-product">
                <SelectValue placeholder="Продукт" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все продукты</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-5">
                <Skeleton className="h-5 w-3/4 mb-3" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <div className="flex gap-2 mb-4">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">Проверки не найдены</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/rule/new")}>
              Создать первую проверку
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((rule) => {
              const statusInfo = STATUS_MAP[rule.status] || STATUS_MAP.DRAFT;
              const StatusIcon = statusInfo.icon;
              const isMine = rule.pm_responsible_id === CURRENT_USER;

              return (
                <div
                  key={rule.id}
                  className="group rounded-lg border border-border bg-card hover:border-primary/30 transition-colors cursor-pointer relative"
                  onClick={() => navigate(`/rule/${rule.id}`)}
                  data-testid={`card-rule-${rule.id}`}
                >
                  <div className="p-5">
                    <h3 className="font-medium text-sm text-foreground mb-1.5 pr-8 line-clamp-2" data-testid={`text-rule-name-${rule.id}`}>
                      {rule.indicator}
                    </h3>
                    {rule.description && (
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                        {rule.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <Badge variant="secondary" className="text-xs font-normal">
                        {rule.incident_id}
                      </Badge>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {rule.product_type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {rule.check_mode === "SIMPLE" ? "Конструктор" : "SQL"}
                      </Badge>
                      {rule.target_table && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {rule.target_schema}.{rule.target_table}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className={`flex items-center gap-1.5 text-xs ${statusInfo.className}`}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        <span>{statusInfo.label}</span>
                      </div>

                      {isMine && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-menu-${rule.id}`}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => handleDuplicate(rule)}>
                              <Copy className="w-4 h-4 mr-2" /> Дублировать
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleArchive(rule)}>
                              <Archive className="w-4 h-4 mr-2" /> В архив
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(rule.id)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Удалить
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
