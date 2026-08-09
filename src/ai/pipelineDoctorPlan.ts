import type {PipelineStageId} from "./pipelineControl";

export interface PipelineDoctorRoots {
  league: string;
  stage1: string;
  stage2: string;
  stage3: string;
  stage4: string;
  stage5: string;
  corpus: string;
}

export interface PipelineDoctorSpec {
  stage: PipelineStageId;
  file: string;
  args: string[];
}

export function buildPipelineDoctorPlan(roots: PipelineDoctorRoots, verifySources: boolean): PipelineDoctorSpec[] {
  const sourceFlag = verifySources ? ["--verify-sources"] : [];
  return [
    {stage: "stage0", file: "src/cli/leagueControl.ts", args: ["doctor", "--out", roots.league]},
    {stage: "stage1", file: "src/cli/decisionDossiers.ts", args: ["doctor", "--out", roots.stage1, ...sourceFlag]},
    {stage: "stage2", file: "src/cli/positionValue.ts", args: ["doctor", "--out", roots.stage2, ...sourceFlag]},
    {stage: "stage3", file: "src/cli/managerProgramV2.ts", args: ["doctor", "--out", roots.stage3, "--dossiers", roots.stage1, "--position-value", roots.stage2, "--corpus", roots.corpus, ...sourceFlag]},
    {stage: "stage4", file: "src/cli/autonomousResearch.ts", args: ["doctor", "--out", roots.stage4, "--manager-programs", roots.stage3, "--source-corpus", roots.corpus, ...sourceFlag]},
    {stage: "stage5", file: "src/cli/formalValidation.ts", args: ["doctor", "--out", roots.stage5, "--autonomous-research", roots.stage4, "--manager-programs", roots.stage3, "--position-value", roots.stage2, ...sourceFlag]},
  ];
}
