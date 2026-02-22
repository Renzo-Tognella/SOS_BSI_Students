"use client";

import { useEffect, useState } from "react";
import { Bot, Download, FileJson, FileText } from "lucide-react";

import {
  ROADMAP_ASSISTANT_TOGGLE_EVENT,
  ROADMAP_EXPORT_JSON_EVENT,
  ROADMAP_EXPORT_PDF_EVENT,
  ROADMAP_EXPORT_STATE_UPDATED_EVENT,
  EMPTY_EXPORT_STATE,
  dispatchRoadmapEvent,
  readExportStateFromStorage,
  type RoadmapWorkspaceExportState
} from "@/components/roadmap/layout/workspace-events";

export function RoadmapHeaderActions() {
  const [state, setState] = useState<RoadmapWorkspaceExportState>(EMPTY_EXPORT_STATE);

  useEffect(() => {
    const sync = () => {
      setState(readExportStateFromStorage());
    };

    sync();

    window.addEventListener("storage", sync);
    window.addEventListener(ROADMAP_EXPORT_STATE_UPDATED_EVENT, sync);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(ROADMAP_EXPORT_STATE_UPDATED_EVENT, sync);
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button
        aria-label="Abrir assistente de IA"
        className="roadmap-header-button"
        disabled={!state.canExportJson}
        onClick={() => dispatchRoadmapEvent(ROADMAP_ASSISTANT_TOGGLE_EVENT)}
        type="button"
      >
        <Bot className="h-4 w-4" />
        <span>IA</span>
      </button>

      <button
        aria-label="Exportar roadmap em JSON"
        className="roadmap-header-button"
        disabled={!state.canExportJson}
        onClick={() => dispatchRoadmapEvent(ROADMAP_EXPORT_JSON_EVENT)}
        type="button"
      >
        <FileJson className="h-4 w-4" />
        <span>JSON</span>
      </button>

      <button
        aria-label="Exportar relatório em PDF"
        className="roadmap-header-button roadmap-header-button-primary"
        disabled={!state.canExportPdf || state.pdfBusy}
        onClick={() => dispatchRoadmapEvent(ROADMAP_EXPORT_PDF_EVENT)}
        type="button"
      >
        <FileText className="h-4 w-4" />
        <span>{state.pdfBusy ? "Gerando" : "PDF"}</span>
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}
