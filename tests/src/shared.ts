import { CallableCell, PlayerApp } from '@holochain/tryorama';

export function getCellByRoleName(player: PlayerApp, roleName: string): CallableCell {
  const cells = player.cells;
  return cells.find((cell) => cell.name === roleName);
}

export const GROUP_HAPP_PATH = process.cwd() + '/../workdir/group.happ';
// export const GROUP_HAPP_PATH = process.cwd() + '/../resources/default-apps/group.happ';
