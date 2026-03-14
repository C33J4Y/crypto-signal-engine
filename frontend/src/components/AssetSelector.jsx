const ASSETS = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

function AssetSelector({ selected, onSelect }) {
  return (
    <div className="asset-selector">
      {ASSETS.map(asset => (
        <button
          key={asset}
          className={`asset-btn ${selected === asset ? 'active' : ''}`}
          onClick={() => onSelect(asset)}
        >
          {asset === 'ALL' ? 'All' : asset.replace('USDT', '')}
        </button>
      ))}
    </div>
  );
}

export default AssetSelector;
