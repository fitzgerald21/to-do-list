import type { Scope } from "../App";
import { listPath } from "../lib/tree";
import { getData } from "../state/store";
import { SPACES } from "../types";
import { Composer } from "./Composer";

export function CaptureBar({ scope, onOpenTask }: { scope: Scope; onOpenTask: (id: string) => void }) {
  return (
    <div className="capture-bar">
      <Composer
        placeholder="Say or type a to-do or an update…"
        opts={() => {
          const { lists } = getData();
          let viewing: string[] | null = null;
          if (scope.kind === "space") viewing = [SPACES.find((s) => s.id === scope.space)!.name];
          if (scope.kind === "list") {
            const l = lists.find((x) => x.id === scope.id);
            if (l) viewing = listPath(lists, l.id, l.space);
          }
          return { viewing };
        }}
        onApplied={(ids) => {
          // A single brand-new task with lots of detail? Open it so you can see.
          if (ids.length === 1) {
            const t = getData().tasks.find((x) => x.id === ids[0]);
            if (t && t.notes.length > 140) onOpenTask(t.id);
          }
        }}
      />
    </div>
  );
}
