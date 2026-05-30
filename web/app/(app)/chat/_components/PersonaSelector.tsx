import type { Database } from "@/lib/db/types";

type PersonaRow = Database["public"]["Tables"]["personas"]["Row"];

type Props = {
  personas: PersonaRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
};

export function PersonaSelector({ personas, selectedIds, onToggle }: Props) {
  if (personas.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2 py-2">
      <p className="w-full text-[10px] font-bold uppercase tracking-[0.18em] text-faint-foreground">Generate for:</p>
      {personas.map((persona) => {
        const selected = selectedIds.includes(persona.id);
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => onToggle(persona.id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              selected
                ? "border-transparent text-white"
                : "border-border text-muted-foreground hover:border-border-strong"
            }`}
            style={selected ? { backgroundColor: persona.avatar_color, borderColor: persona.avatar_color } : {}}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: persona.avatar_color }}
            >
              {persona.name.charAt(0).toUpperCase()}
            </span>
            {persona.name}
          </button>
        );
      })}
    </div>
  );
}
