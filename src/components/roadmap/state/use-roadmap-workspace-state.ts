"use client";

import { useCallback, useEffect, useState } from "react";

interface RoadmapUiState {
  focusModeEnabled: boolean;
  focusedSubjectCode: string | null;
  achievementToastOpen: boolean;
}

const STORAGE_KEY = "roadmap_visual_ui_state_v1";

const defaultState: RoadmapUiState = {
  focusModeEnabled: false,
  focusedSubjectCode: null,
  achievementToastOpen: false
};

export function useRoadmapWorkspaceState() {
  const [uiState, setUiState] = useState<RoadmapUiState>(defaultState);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<RoadmapUiState>;
      setUiState((current) => ({
        ...current,
        focusModeEnabled: Boolean(parsed.focusModeEnabled),
        focusedSubjectCode: parsed.focusedSubjectCode ?? null,
        achievementToastOpen: Boolean(parsed.achievementToastOpen)
      }));
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(uiState));
    } catch {
      // ignore write errors
    }
  }, [uiState]);

  const toggleFocusMode = useCallback((next?: boolean) => {
    setUiState((current) => ({
      ...current,
      focusModeEnabled: typeof next === "boolean" ? next : !current.focusModeEnabled
    }));
  }, []);

  const setFocusedSubject = useCallback((code: string | null) => {
    setUiState((current) => ({
      ...current,
      focusedSubjectCode: code
    }));
  }, []);

  const openAchievementToast = useCallback(() => {
    setUiState((current) => ({
      ...current,
      achievementToastOpen: true
    }));
  }, []);

  const closeAchievementToast = useCallback(() => {
    setUiState((current) => ({
      ...current,
      achievementToastOpen: false
    }));
  }, []);

  return {
    uiState,
    toggleFocusMode,
    setFocusedSubject,
    openAchievementToast,
    closeAchievementToast
  };
}
