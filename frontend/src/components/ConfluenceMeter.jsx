function ConfluenceMeter({ score, grade }) {
  const percentage = Math.min((score / 10) * 100, 100);

  return (
    <div className="confluence-meter">
      <div className="meter-header">
        <span className="meter-score">{score}/10</span>
        <span className="meter-grade">{grade}</span>
      </div>
      <div className="meter-bar">
        <div className="meter-fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export default ConfluenceMeter;
