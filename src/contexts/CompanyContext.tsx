import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

export type Company = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type CompanyMembership = {
  role: "owner" | "admin" | "member" | "viewer";
  company: Company;
};

type CompanyContextValue = {
  companies: CompanyMembership[];
  activeCompany: Company | null;
  activeRole: CompanyMembership["role"] | null;
  loading: boolean;
  refreshCompanies: () => Promise<void>;
  createCompany: (name: string) => Promise<void>;
  selectCompany: (companyId: string) => void;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);
const STORAGE_KEY = "valora.activeCompanyId";

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  const refreshCompanies = useCallback(async () => {
    if (!supabase || !user) {
      setCompanies([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Accept pending invitations that match the authenticated user's e-mail.
    // This keeps invitation onboarding inside Valora without requiring a separate e-mail service.
    await supabase.rpc("accept_my_company_invitations");

    const { data, error } = await supabase
      .from("company_members")
      .select("role, created_at, company:companies(id, name, slug, created_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      setLoading(false);
      throw error;
    }

    const memberships = (data ?? [])
      .map((row) => {
        const company = row.company as unknown as Company | null;
        if (!company) return null;
        return {
          role: row.role as CompanyMembership["role"],
          company,
        };
      })
      .filter((item): item is CompanyMembership => Boolean(item));

    setCompanies(memberships);

    const storedStillExists = memberships.some(
      (item) => item.company.id === activeCompanyId,
    );
    if (!storedStillExists) {
      const firstId = memberships[0]?.company.id ?? null;
      setActiveCompanyId(firstId);
      if (firstId) localStorage.setItem(STORAGE_KEY, firstId);
      else localStorage.removeItem(STORAGE_KEY);
    }

    setLoading(false);
  }, [activeCompanyId, user]);

  useEffect(() => {
    void refreshCompanies();
  }, [refreshCompanies]);

  const activeMembership =
    companies.find((item) => item.company.id === activeCompanyId) ?? null;

  const value = useMemo<CompanyContextValue>(
    () => ({
      companies,
      activeCompany: activeMembership?.company ?? null,
      activeRole: activeMembership?.role ?? null,
      loading,
      refreshCompanies,
      async createCompany(name) {
        if (!supabase) throw new Error("Supabase não configurado.");
        const cleanName = name.trim();
        if (cleanName.length < 2) throw new Error("Informe um nome válido para a empresa.");

        const { data, error } = await supabase.rpc("create_company_with_owner", {
          company_name: cleanName,
        });
        if (error) throw error;

        const companyId = String(data);
        setActiveCompanyId(companyId);
        localStorage.setItem(STORAGE_KEY, companyId);
        await refreshCompanies();
      },
      selectCompany(companyId) {
        setActiveCompanyId(companyId);
        localStorage.setItem(STORAGE_KEY, companyId);
      },
    }),
    [activeMembership, companies, loading, refreshCompanies],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) throw new Error("useCompany deve ser usado dentro de CompanyProvider.");
  return context;
}
