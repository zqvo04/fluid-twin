/**
 * Plant tag scheme (PLAN-V2 §4.3 P1-3): `{code}-1{nn}{A|B}`, unit 100 fixed.
 * `nn` counts per code from 01. Only pumps take the A/B suffix: duty and
 * standby of one service share a number (P-101A / P-101B).
 */

import { ValidationIssue } from '../domain/network';
import { EquipmentTile, GridModel, InstrumentType, Tile } from './types';

export type TagCode = 'TK' | 'S' | 'P' | 'E' | 'FCV' | 'HV' | 'CT' | InstrumentType;

// FIC before FI so the alternation doesn't stop at the shorter prefix.
const TAG_RE = /^(TK|S|P|E|FCV|HV|CT|FIC|FI|PI|LI)-1(\d\d)([AB])?$/;

export function isEquipment(tile: Tile): tile is EquipmentTile {
  return 'tag' in tile;
}

/** The tag code an equipment tile must carry. */
export function tagCode(tile: EquipmentTile): TagCode {
  switch (tile.kind) {
    case 'basin':
      return 'TK';
    case 'strainer':
      return 'S';
    case 'pump':
      return 'P';
    case 'hx':
      return 'E';
    case 'valve':
      return tile.service === 'control' ? 'FCV' : 'HV';
    case 'spray':
      return 'CT';
  }
}

export interface ParsedTag {
  code: TagCode;
  seq: number;
  suffix?: 'A' | 'B';
}

/** Parse a tag; null if it breaks the format (incl. A/B on a non-pump, or 00). */
export function parseTag(tag: string): ParsedTag | null {
  const m = TAG_RE.exec(tag);
  if (!m) return null;
  const code = m[1] as TagCode;
  const seq = Number(m[2]);
  const suffix = m[3] as 'A' | 'B' | undefined;
  if (seq === 0 || (suffix && code !== 'P')) return null;
  return { code, seq, suffix };
}

function allTags(grid: GridModel): string[] {
  return [...grid.tiles.filter(isEquipment).map((t) => t.tag), ...grid.instruments.map((i) => i.tag)];
}

const fmt = (code: TagCode, seq: number, suffix = '') => `${code}-1${String(seq).padStart(2, '0')}${suffix}`;

/**
 * Next free tag for `code` in this model. Pumps first complete an open duty/
 * standby pair (a number with only A taken gets B), else open a new number
 * with A.
 * shortcut: any lone pump is paired with the next one placed — right for the
 * single A/B service in V2's loop; a multi-service plant needs explicit pairing.
 */
export function nextTag(grid: GridModel, code: TagCode): string {
  const taken = new Set(allTags(grid));
  if (code === 'P') {
    for (let seq = 1; seq <= 99; seq++) {
      if (taken.has(fmt('P', seq, 'A')) && !taken.has(fmt('P', seq, 'B'))) return fmt('P', seq, 'B');
    }
  }
  for (let seq = 1; seq <= 99; seq++) {
    const tag = code === 'P' ? fmt(code, seq, 'A') : fmt(code, seq);
    if (code === 'P' ? !taken.has(tag) && !taken.has(fmt('P', seq, 'B')) : !taken.has(tag)) return tag;
  }
  throw new Error(`No free ${code} tag left in unit 100.`);
}

/** Format, code-vs-element and uniqueness checks. Warnings: tags never block a solve. */
export function validateTags(grid: GridModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const owners = new Map<string, string[]>();
  const check = (tag: string, ref: string, expected: TagCode) => {
    const parsed = parseTag(tag);
    if (!parsed) {
      issues.push({ severity: 'warning', message: `Tag "${tag}" does not match {code}-1nn[A|B].`, ref });
    } else if (parsed.code !== expected) {
      issues.push({ severity: 'warning', message: `Tag "${tag}" should use code ${expected}.`, ref });
    }
    owners.set(tag, [...(owners.get(tag) ?? []), ref]);
  };
  for (const t of grid.tiles) if (isEquipment(t)) check(t.tag, t.id, tagCode(t));
  for (const i of grid.instruments) check(i.tag, i.tag, i.type);
  for (const [tag, refs] of owners) {
    if (refs.length > 1) issues.push({ severity: 'warning', message: `Tag "${tag}" is used ${refs.length} times.`, ref: refs[1] });
  }
  return issues;
}
