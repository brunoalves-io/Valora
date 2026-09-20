
import { useEffect, useState, type ReactNode } from "react";
import { useCompany } from "../contexts/CompanyContext";
import { supabase } from "../lib/supabase";

function horizonIso(days = 90) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function RecurringSyncGate({ children }: { children: ReactNode }) {
  const { activeCompany } = useCompany();
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (!supabase || !activeCompany) {
        if (!cancelled) setSyncing(false);
        return;
      }

      setSyncing(true);
      await supabase.rpc("materialize_recurring_transactions", {
        p_company_id: activeCompany.id,
        p_through_date: horizonIso(90),
      });

      if (!cancelled) setSyncing(false);
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [activeCompany?.id]);

  if (syncing) {
    return <div className="panel empty-state">Atualizando previsões recorrentes...</div>;
  }

  return <>{children}</>;
}
