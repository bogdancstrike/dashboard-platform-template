import { Route, Routes } from "react-router-dom";

import { AppShell } from "@/app/AppShell";
import {
  accountRoutes,
  adminRoutes,
  analyseRoutes,
  findRoutes,
  overviewRoutes,
  recordRoutes,
  systemRoutes,
  workRoutes,
} from "@/app/routes";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";

/**
 * The application: every page inside the shell.
 *
 * The route table lives in `app/routes/`, one module per navigation area.
 */
export default function App() {
  return (
    <>
      {/* The assistant's launcher (⌘J) floats over every page (§41). */}
      <AssistantLauncher />
      <Routes>
        <Route element={<AppShell />}>
          {overviewRoutes}
          {analyseRoutes}
          {workRoutes}
          {recordRoutes}
          {findRoutes}
          {adminRoutes}
          {accountRoutes}
          {systemRoutes}
        </Route>
      </Routes>
    </>
  );
}
