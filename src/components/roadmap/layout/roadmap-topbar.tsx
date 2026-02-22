"use client";

import { useEffect, useState } from "react";
import { Bell, GraduationCap, Search, Sparkles } from "lucide-react";

import { RoadmapHeaderActions } from "@/components/roadmap/layout/roadmap-header-actions";
import { ROADMAP_WORKSPACE_STORAGE_KEY } from "@/components/roadmap/layout/workspace-events";

interface RoadmapTopbarProps {
  sectionLabel: string;
}

interface StudentTopbarSnapshot {
  studentName: string;
  registrationId: string;
  courseName: string;
}

const emptySnapshot: StudentTopbarSnapshot = {
  studentName: "Aluno não carregado",
  registrationId: "--",
  courseName: "Histórico não processado"
};

function readStudentSnapshot(): StudentTopbarSnapshot {
  if (typeof window === "undefined") {
    return emptySnapshot;
  }

  try {
    const raw = window.localStorage.getItem(ROADMAP_WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return emptySnapshot;
    }

    const parsed = JSON.parse(raw) as {
      parsedTranscript?: {
        student?: {
          fullName?: string;
          registrationId?: string;
          courseName?: string;
        };
      };
    };

    return {
      studentName: parsed.parsedTranscript?.student?.fullName?.trim() || emptySnapshot.studentName,
      registrationId: parsed.parsedTranscript?.student?.registrationId?.trim() || emptySnapshot.registrationId,
      courseName: parsed.parsedTranscript?.student?.courseName?.trim() || emptySnapshot.courseName
    };
  } catch {
    return emptySnapshot;
  }
}

export function RoadmapTopbar({ sectionLabel }: RoadmapTopbarProps) {
  const [snapshot, setSnapshot] = useState<StudentTopbarSnapshot>(emptySnapshot);

  useEffect(() => {
    const sync = () => {
      setSnapshot(readStudentSnapshot());
    };

    sync();
    window.addEventListener("storage", sync);
    const interval = window.setInterval(sync, 2000);

    return () => {
      window.removeEventListener("storage", sync);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <header className="roadmap-topbar">
      <div className="roadmap-topbar-left">
        <div className="roadmap-topbar-section-pill">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{sectionLabel}</span>
        </div>

        <div className="roadmap-topbar-course">
          <h1>Dashboard Acadêmico</h1>
          <p>
            <GraduationCap className="h-4 w-4" />
            <span>{snapshot.studentName}</span>
            <span className="text-[var(--text-muted)]">{snapshot.registrationId}</span>
            <span className="text-[var(--text-muted)]">{snapshot.courseName}</span>
          </p>
        </div>
      </div>

      <div className="roadmap-topbar-right">
        <button aria-label="Pesquisar" className="roadmap-icon-button" type="button">
          <Search className="h-4 w-4" />
        </button>
        <button aria-label="Notificações" className="roadmap-icon-button" type="button">
          <Bell className="h-4 w-4" />
        </button>
        <RoadmapHeaderActions />
      </div>
    </header>
  );
}
