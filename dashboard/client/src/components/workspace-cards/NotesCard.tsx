import { NotebookPen, Pin, Plus } from "lucide-react";

export type OperatorNote = {
  id: string;
  content: string;
  createdAt: string;
  isPinned: boolean;
};

type NotesCardProps = {
  notes: OperatorNote[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAddNote: () => void;
  onTogglePin: (id: string) => void;
  className?: string;
};

export function NotesCard({ notes, draft, onDraftChange, onAddNote, onTogglePin, className = "" }: NotesCardProps) {
  return (
    <article className={`workspace-card notes-card ${className}`.trim()} aria-label="Operator notes">
      <header className="workspace-card-head">
        <div>
          <p className="eyebrow">Private operator log</p>
          <h2>Notes</h2>
          <span>Keep short observations in the current browser session.</span>
        </div>
        <span className="workspace-card-state"><NotebookPen size={10} />LOCAL</span>
      </header>

      <form className="notes-compose" onSubmit={(event) => { event.preventDefault(); onAddNote(); }}>
        <input value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Capture an observation…" aria-label="New private note" />
        <button type="submit" disabled={!draft.trim()} aria-label="Save note"><Plus size={13} /></button>
      </form>

      <section className="notes-list" aria-label="Saved private notes">
        {notes.length ? notes.map((note) => (
          <article className={`notes-entry ${note.isPinned ? "is-pinned" : ""}`} key={note.id}>
            <button type="button" onClick={() => onTogglePin(note.id)} aria-label={note.isPinned ? "Unpin note" : "Pin note"}><Pin size={10} /></button>
            <p>{note.content}</p>
            <time>{note.createdAt}</time>
          </article>
        )) : <div className="notes-empty"><NotebookPen size={17} /><span>No private notes in this session.</span></div>}
      </section>
    </article>
  );
}
