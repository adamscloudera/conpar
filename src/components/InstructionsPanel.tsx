import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

export type WorkflowStep = 1 | 2 | 3 | 4 | 5;

type Props = {
  currentStep: WorkflowStep;
};

const STEPS = [
  {
    n: 1 as WorkflowStep,
    title: 'Upload Connection Parameters Template',
    detail: 'Export the template from Octopai Admin Console → Connection Parameters, then drop the XLSX file below.',
  },
  {
    n: 2 as WorkflowStep,
    title: 'Copy search terms into Octopai Discovery Space',
    detail: 'Use the suggested terms to run Advanced Search in Discovery → Impala Columns. Download the CSV results.',
  },
  {
    n: 3 as WorkflowStep,
    title: 'Upload Discovery exports',
    detail: 'Drop one or more discovery CSVs (Impala Columns exports or lineage map CSVs) below.',
  },
  {
    n: 4 as WorkflowStep,
    title: 'Review matches and correct if needed',
    detail: 'Auto-filled rows are ready. Rows flagged amber have multiple candidates — select the best match.',
  },
  {
    n: 5 as WorkflowStep,
    title: 'Export populated template',
    detail: 'Download the completed XLSX and re-import it into Octopai Admin Console → Connection Parameters.',
  },
]

function stepStatus(step: WorkflowStep, current: WorkflowStep): 'done' | 'active' | 'pending' {
  if (step < current) return 'done'
  if (step === current) return 'active'
  return 'pending'
}

export function InstructionsPanel({ currentStep }: Props) {
  return (
    <div className="surface-card p-5">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-4">Workflow</h2>
      <ol className="space-y-3">
        {STEPS.map((step) => {
          const status = stepStatus(step.n, currentStep)
          return (
            <li key={step.n} className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {status === 'done' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                {status === 'active' && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                {status === 'pending' && <Circle className="w-5 h-5 text-gray-300" />}
              </div>
              <div className={clsx('flex-1 min-w-0', status === 'pending' && 'opacity-40')}>
                <p className={clsx('text-sm font-medium', status === 'active' ? 'text-primary' : 'text-foreground')}>
                  {step.n}. {step.title}
                </p>
                {status !== 'pending' && (
                  <p className="text-xs text-muted mt-0.5">{step.detail}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
