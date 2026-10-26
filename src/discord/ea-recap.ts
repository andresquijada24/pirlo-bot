import type { APIEmbed } from 'discord-api-types/v10';
import { discordTime } from '../core/time.js';
import type { EaRecap, EaRecapPlayer } from '../db/repositories/types.js';
import { embed, escapeMd } from './responses.js';

/**
 * Resumen de un partido de EA para el canal de resultados del club.
 * Solo jugadores propios; del rival solo se muestran su nombre y el marcador.
 */

const RESULT = {
  victoria: { icon: '🟢', label: 'Victoria' },
  empate: { icon: '🟡', label: 'Empate' },
  derrota: { icon: '🔴', label: 'Derrota' },
} as const;

const TYPE_LABELS: Record<EaRecap['matchType'], string> = {
  leagueMatch: 'Liga',
  playoffMatch: 'Playoff',
  friendlyMatch: 'Amistoso',
};

const FIELD_MAX = 1024;

function clip(text: string): string {
  return text.length > FIELD_MAX ? `${text.slice(0, FIELD_MAX - 1)}…` : text;
}

/** "Ana ×2 · Beto" con quienes tienen el dato mayor que cero. */
function tally(players: EaRecapPlayer[], pick: (p: EaRecapPlayer) => number | null): string {
  const list = players
    .map((p) => ({ name: escapeMd(p.name), n: pick(p) }))
    .filter((x): x is { name: string; n: number } => x.n !== null && x.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'es'))
    .map((x) => (x.n > 1 ? `${x.name} ×${x.n}` : x.name));
  return list.length ? clip(list.join(' · ')) : '—';
}

function mvp(players: EaRecapPlayer[]): string {
  const chosen = players.find((p) => p.manOfTheMatch);
  if (chosen) return `${escapeMd(chosen.name)}${chosen.rating !== null ? ` (${chosen.rating.toFixed(1)})` : ''}`;
  const best = players.filter((p) => p.rating !== null).sort((a, b) => b.rating! - a.rating!)[0];
  return best ? `${escapeMd(best.name)} (${best.rating!.toFixed(1)}, mejor nota)` : '—';
}

export function recapEmbed(r: EaRecap, clubName: string): APIEmbed {
  const res = r.result ? RESULT[r.result] : null;
  const score = r.goalsFor !== null && r.goalsAgainst !== null ? `${r.goalsFor}-${r.goalsAgainst}` : 'vs';
  const ratings = r.players
    .map((p) => `${p.rating !== null ? p.rating.toFixed(1) : '—'} · ${escapeMd(p.name)}`)
    .join('\n');
  return embed({
    title: `${res?.icon ?? '⚪'} ${escapeMd(clubName)} ${score} ${escapeMd(r.opponentName ?? 'Rival')}`,
    description: `${res?.label ?? 'Resultado sin dato'} · ${TYPE_LABELS[r.matchType]} · ${discordTime(r.playedAt, 'f')}`,
    fields: [
      { name: '⚽ Goles', value: tally(r.players, (p) => p.goals), inline: false },
      { name: '🅰️ Asistencias', value: tally(r.players, (p) => p.assists), inline: false },
      { name: '⭐ MVP', value: mvp(r.players), inline: false },
      { name: '📊 Notas', value: clip(ratings || '—'), inline: false },
    ],
  });
}

/** Encabezado del mensaje: balance de los partidos anunciados. */
export function recapHeader(recaps: EaRecap[], clubName: string): string {
  const count = (k: keyof typeof RESULT) => recaps.filter((r) => r.result === k).length;
  const n = recaps.length;
  return (
    `📋 **${escapeMd(clubName)}** · ${n} ${n === 1 ? 'partido nuevo' : 'partidos nuevos'} de EA` +
    ` · ${count('victoria')}V ${count('empate')}E ${count('derrota')}D`
  );
}
