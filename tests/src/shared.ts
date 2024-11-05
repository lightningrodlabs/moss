import { AnyDhtHash, DnaHash } from '@holochain/client';
import { CallableCell, Player } from '@holochain/tryorama';

export function getCellByRoleName(player: Player, roleName: string): CallableCell {
  const cells = player.cells;
  return cells.find((cell) => cell.name === roleName);
}

export const GROUP_HAPP_PATH = process.cwd() + '/../workdir/group.happ';
