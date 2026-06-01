import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

const FLASK_URL = process.env.FLASK_URL || "http://localhost:5001";

/**
 * Проверяет доступность Flask-бэкенда.
 */
async function isFlaskAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${FLASK_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Проксирует запрос на Flask. Если Flask недоступен — возвращает false.
 */
async function proxyToFlask(req: Request, res: Response): Promise<boolean> {
  const flaskUp = await isFlaskAvailable();
  if (!flaskUp) return false;

  try {
    const url = `${FLASK_URL}${req.originalUrl}`;
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const flaskRes = await fetch(url, fetchOptions);
    const data = await flaskRes.json();
    res.status(flaskRes.status).json(data);
    return true;
  } catch (e: any) {
    console.log(`[proxy] Flask proxy failed: ${e.message}, falling back to in-memory`);
    return false;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Проверка Flask при старте
  const flaskOk = await isFlaskAvailable();
  if (flaskOk) {
    console.log(`[routes] Flask backend detected at ${FLASK_URL} — proxying API requests`);
  } else {
    console.log(`[routes] Flask backend not available — using in-memory storage (demo mode)`);
  }

  // === Получение списка правил ===
  app.get("/api/v1/rules", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      const filters = {
        owner_id: req.query.owner_id as string | undefined,
        incident_id: req.query.incident_id as string | undefined,
        status: req.query.status as string | undefined,
        search: req.query.search as string | undefined,
      };
      const rules = await storage.getRules(filters);
      res.json({ status: "success", data: rules });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // === Получение одного правила ===
  app.get("/api/v1/rules/:id", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ status: "error", message: "Невалидный ID" });
      }
      const rule = await storage.getRule(id);
      if (!rule) {
        return res.status(404).json({ status: "error", message: "Правило не найдено" });
      }
      res.json({ status: "success", data: rule });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // === UPSERT правила ===
  app.post("/api/v1/rules", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      const body = req.body;
      const rule = await storage.upsertRule(body);
      res.json({ status: "success", data: rule });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // === Удаление правила ===
  app.delete("/api/v1/rules/:id", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ status: "error", message: "Невалидный ID" });
      }
      const deleted = await storage.deleteRule(id);
      if (!deleted) {
        return res.status(404).json({ status: "error", message: "Правило не найдено" });
      }
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // === Тестовый прогон ===
  app.post("/api/v1/rules/test", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      // Фоллбэк: имитация
      const passed = Math.random() > 0.3;
      const rowsChecked = Math.floor(Math.random() * 1000) + 100;
      const rowsPassed = passed ? rowsChecked : Math.floor(rowsChecked * (0.5 + Math.random() * 0.4));

      await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));

      res.json({
        status: "success",
        data: {
          passed,
          rows_checked: rowsChecked,
          rows_passed: rowsPassed,
          percentage: +(rowsPassed / rowsChecked).toFixed(4),
          executed_query: "SELECT CASE WHEN amount > 0 THEN true ELSE false END AS res FROM dal_data.payments_table WHERE status = 'SUCCESS'",
        },
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // === Метаданные таблиц ===
  app.get("/api/v1/metadata/tables", async (req, res) => {
    if (await proxyToFlask(req, res)) return;
    try {
      const metadata = await storage.getTableMetadata();
      res.json({ status: "success", data: metadata });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  return httpServer;
}
