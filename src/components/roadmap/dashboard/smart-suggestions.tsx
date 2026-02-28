"use client";

import { Lightbulb } from "lucide-react";

interface SmartSuggestionsProps {
  suggestions: string[];
}

export function SmartSuggestions({ suggestions }: SmartSuggestionsProps) {
  return (
    <section className="dashboard-card">
      <header className="dashboard-card-header">
        <h3>Smart Suggestions</h3>
      </header>

      {suggestions.length === 0 ? (
        <p className="empty-copy">Sem recomendações no momento.</p>
      ) : (
        <ul className="smart-suggestions-list">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <Lightbulb className="h-4 w-4" />
              <span>{suggestion}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
