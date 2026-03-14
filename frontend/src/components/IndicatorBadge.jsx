function IndicatorBadge({ label, active }) {
  return (
    <span className={`indicator-badge ${active ? 'active' : 'inactive'}`}>
      {label}
    </span>
  );
}

export default IndicatorBadge;
