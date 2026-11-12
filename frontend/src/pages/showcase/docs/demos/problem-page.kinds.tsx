import { Link } from "react-router-dom";

import { ERROR_SLUGS, PROBLEMS, PROBLEM_KINDS } from "@/components/ProblemPage";

export default function ProblemPageKinds() {
  return (
    <ul className="nx-doc-links">
      {PROBLEM_KINDS.map((kind) => (
        <li key={kind}>
          <Link to={`/errors/${ERROR_SLUGS[kind]}`}>{PROBLEMS[kind].title}</Link>
          <code>/errors/{ERROR_SLUGS[kind]}</code>
        </li>
      ))}
    </ul>
  );
}
