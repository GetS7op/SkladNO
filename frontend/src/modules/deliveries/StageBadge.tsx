import { type Stage, stageLabel } from '../../core/domain';

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge stage-${stage}`}>{stageLabel(stage)}</span>;
}
