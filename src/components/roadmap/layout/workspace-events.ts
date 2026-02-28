export const ROADMAP_WORKSPACE_STORAGE_KEY = "roadmap_workspace_state_v2";
export const ROADMAP_WORKSPACE_EXPORT_STATE_KEY = "roadmap_workspace_export_state_v1";

export const ROADMAP_EXPORT_JSON_EVENT = "roadmap:export-json";
export const ROADMAP_EXPORT_PDF_EVENT = "roadmap:export-pdf";
export const ROADMAP_EXPORT_STATE_UPDATED_EVENT = "roadmap:export-state-updated";
export const ROADMAP_ASSISTANT_TOGGLE_EVENT = "roadmap:assistant-toggle";

export interface RoadmapWorkspaceExportState {
  canExportJson: boolean;
  canExportPdf: boolean;
  pdfBusy: boolean;
}

export const EMPTY_EXPORT_STATE: RoadmapWorkspaceExportState = {
  canExportJson: false,
  canExportPdf: false,
  pdfBusy: false
};

export function readExportStateFromStorage(): RoadmapWorkspaceExportState {
  if (typeof window === "undefined") {
    return EMPTY_EXPORT_STATE;
  }

  try {
    const raw = window.localStorage.getItem(ROADMAP_WORKSPACE_EXPORT_STATE_KEY);
    if (!raw) {
      return EMPTY_EXPORT_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<RoadmapWorkspaceExportState>;
    return {
      canExportJson: Boolean(parsed.canExportJson),
      canExportPdf: Boolean(parsed.canExportPdf),
      pdfBusy: Boolean(parsed.pdfBusy)
    };
  } catch {
    return EMPTY_EXPORT_STATE;
  }
}

export function dispatchRoadmapEvent(eventName: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName));
}
