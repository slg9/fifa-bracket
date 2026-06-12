/* ui.jsx — composants partagés (window) */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function Flag({ team, size = 22 }) {
  if (!team) return <span className="flag flag--tbd" style={{ fontSize: size }}>•</span>;
  return <span className="flag" style={{ fontSize: size, lineHeight: 1 }} title={team.name}>{team.flag}</span>;
}

// libellé d'équipe : drapeau + nom (+ code optionnel)
function TeamLabel({ team, slot, showCode, size = 22, strong }) {
  if (!team) {
    return (
      <span className="team team--tbd">
        <span className="flag flag--tbd" style={{ fontSize: size }}>?</span>
        <span className="team__name team__name--tbd">{slot ? slotLabel(slot) : "À venir"}</span>
      </span>
    );
  }
  return (
    <span className={"team" + (strong ? " team--strong" : "")}>
      <Flag team={team} size={size} />
      <span className="team__name">{team.name}</span>
      {showCode && <span className="team__code">{team.code}</span>}
    </span>
  );
}

function slotLabel(slot) {
  if (!slot) return "—";
  if (slot[0] === "1") return "1er Gr. " + slot[1];
  if (slot[0] === "2") return "2e Gr. " + slot[1];
  if (slot[0] === "T") return "Meilleur 3e #" + slot.slice(1);
  return "Vainqueur";
}

function Btn({ children, onClick, kind = "ghost", size = "md", title, disabled, className = "" }) {
  return (
    <button
      className={`btn btn--${kind} btn--${size} ${className}`}
      onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

function Segmented({ value, onChange, options }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState({ left: 4, width: 0, ready: false });

  useEffect(() => {
    const measure = () => {
      const root = ref.current; if (!root) return;
      const idx = options.findIndex((o) => o.id === value);
      const btn = root.querySelectorAll(".seg__btn")[idx];
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth, ready: true });
    };
    measure();
    const t = setTimeout(measure, 120);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [value, options]);

  return (
    <div className="seg" ref={ref} role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab"
          className={"seg__btn" + (value === o.id ? " is-active" : "")}
          onClick={() => onChange(o.id)}>
          {o.icon && <span className="seg__icon">{o.icon}</span>}
          <span>{o.label}</span>
        </button>
      ))}
      <div className="seg__thumb" style={{ left: thumb.left, width: thumb.width, opacity: thumb.ready ? 1 : 0 }} />
    </div>
  );
}

Object.assign(window, { Flag, TeamLabel, slotLabel, Btn, Segmented });
