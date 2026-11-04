// 용량 단위 선택 (타이핑 없이 고르기)
import { esc } from '../lib/format.js';
import { PACK_UNITS } from '../lib/model.js';

/**
 * @param {string} attrs   select 에 붙일 속성 (예: 'data-f="packUnit"')
 * @param {string} value   현재 값
 * @param {string} blank   빈 값 옵션 이름
 */
export function unitSelectHTML(attrs, value, blank = '단위') {
  const opts = [...PACK_UNITS];
  if (value && !opts.includes(value)) opts.push(value); // 예전에 적어 둔 다른 단위(조각 등)는 그대로 보여줌
  return `<select ${attrs} class="unit" aria-label="용량 단위">
    <option value="">${esc(blank)}</option>
    ${opts.map((u) => `<option value="${esc(u)}" ${u === value ? 'selected' : ''}>${esc(u)}</option>`).join('')}
  </select>`;
}
