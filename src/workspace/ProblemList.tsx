import type { ValidationProblem } from '../domain/schema/gardenItem'

/**
 * The problems inside a Garden Diagnostic.
 *
 * Shared by the Diagnostics list and the reading panel so the two cannot drift
 * into describing the same finding differently. The field is named alongside
 * the message because a person fixing the file needs to know where to look.
 */
export function ProblemList({ problems }: { readonly problems: readonly ValidationProblem[] }) {
  return (
    <ul className="diagnostics__problems">
      {problems.map((problem, at) => (
        <li key={`${problem.field}-${at}`}>
          <span className="diagnostics__field">{problem.field}</span> {problem.message}
        </li>
      ))}
    </ul>
  )
}
