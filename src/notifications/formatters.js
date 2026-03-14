/**
 * Format a signal for Discord webhook embed.
 */
function formatDiscord(signal) {
  const isLong = signal.direction === 'LONG';
  const color = isLong ? 0x00ff88 : 0xff4444;
  const arrow = isLong ? '🟢' : '🔴';
  const directionEmoji = isLong ? '📈' : '📉';

  const indicatorLines = [];
  const ind = signal.indicators;

  if (ind.rsi && ind.rsi.points > 0) {
    indicatorLines.push(`RSI: ${ind.rsi.value} (${ind.rsi.condition}) [+${ind.rsi.points}]`);
  }
  if (ind.rsiDivergence && ind.rsiDivergence.points > 0) {
    indicatorLines.push(`RSI Divergence: ${ind.rsiDivergence.type} [+${ind.rsiDivergence.points}]`);
  }
  if (ind.fvg && ind.fvg.points > 0) {
    indicatorLines.push(`FVG: ${ind.fvg.direction} zone ${ind.fvg.zoneLow}–${ind.fvg.zoneHigh} [+${ind.fvg.points}]`);
  }
  if (ind.volumeProfilePOC && ind.volumeProfilePOC.points > 0) {
    indicatorLines.push(`POC: ${ind.volumeProfilePOC.poc} (${ind.volumeProfilePOC.distance}) [+${ind.volumeProfilePOC.points}]`);
  }
  if (ind.volumeSpike && ind.volumeSpike.points > 0) {
    indicatorLines.push(`Volume: ${ind.volumeSpike.ratio}x avg [+${ind.volumeSpike.points}]`);
  }
  if (ind.smaRibbon && ind.smaRibbon.points > 0) {
    indicatorLines.push(`SMA Ribbon: ${ind.smaRibbon.alignment} [+${ind.smaRibbon.points}]`);
  }

  return {
    embeds: [{
      title: `${arrow} ${signal.direction} ${signal.symbol} (${signal.timeframe || signal.interval})`,
      description: signal.notes || '',
      color,
      fields: [
        { name: 'Grade', value: `**${signal.grade}** (${signal.confluenceScore}/10)`, inline: true },
        { name: 'Entry', value: `$${signal.entry}`, inline: true },
        { name: 'Stop Loss', value: `$${signal.stopLoss}`, inline: true },
        { name: 'TP1', value: `$${signal.tp1}`, inline: true },
        { name: 'TP2', value: `$${signal.tp2}`, inline: true },
        { name: 'TP3', value: `$${signal.tp3}`, inline: true },
        { name: 'R:R', value: signal.riskReward, inline: true },
        { name: `${directionEmoji} Indicators`, value: indicatorLines.join('\n') || 'N/A', inline: false },
      ],
      footer: { text: `Signal ID: ${signal.id}` },
      timestamp: signal.timestamp,
    }],
  };
}

/**
 * Format a signal for Telegram markdown message.
 */
function formatTelegram(signal) {
  const isLong = signal.direction === 'LONG';
  const arrow = isLong ? '🟢' : '🔴';

  const indicatorLines = [];
  const ind = signal.indicators;

  if (ind.rsi && ind.rsi.points > 0) indicatorLines.push(`  • RSI: ${ind.rsi.value} (${ind.rsi.condition})`);
  if (ind.rsiDivergence && ind.rsiDivergence.points > 0) indicatorLines.push(`  • RSI Divergence: ${ind.rsiDivergence.type}`);
  if (ind.fvg && ind.fvg.points > 0) indicatorLines.push(`  • FVG: ${ind.fvg.direction} zone`);
  if (ind.volumeProfilePOC && ind.volumeProfilePOC.points > 0) indicatorLines.push(`  • POC: ${ind.volumeProfilePOC.poc}`);
  if (ind.volumeSpike && ind.volumeSpike.points > 0) indicatorLines.push(`  • Volume: ${ind.volumeSpike.ratio}x spike`);
  if (ind.smaRibbon && ind.smaRibbon.points > 0) indicatorLines.push(`  • SMA: ${ind.smaRibbon.alignment}`);

  const text = [
    `${arrow} *${signal.direction} ${signal.symbol}* (${signal.timeframe || signal.interval})`,
    `Grade: *${signal.grade}* — Score: ${signal.confluenceScore}/10`,
    '',
    `Entry: \`$${signal.entry}\``,
    `Stop Loss: \`$${signal.stopLoss}\``,
    `TP1: \`$${signal.tp1}\``,
    `TP2: \`$${signal.tp2}\``,
    `TP3: \`$${signal.tp3}\``,
    `R:R: ${signal.riskReward}`,
    '',
    'Indicators:',
    ...indicatorLines,
    '',
    `_${signal.notes || ''}_`,
  ].join('\n');

  return { text, parse_mode: 'Markdown' };
}

module.exports = { formatDiscord, formatTelegram };
