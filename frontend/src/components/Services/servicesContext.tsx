import { createContext, useContext, type JSX, type ReactNode } from "react";
import { useAccountServices, type AccountServices } from "../ExternalServices/useAccountServices";
import { useAdminServices, type AdminServices } from "../ExternalServices/useAdminServices";

/**
 * The two sides of the services page, each with its own data, its own calls and
 * its own failures (R2-6): the account's view of a service and the server's.
 * `admin` is null for an account that is not an admin: the server's side is
 * not even asked for.
 */
interface ServicesValue {
  account: AccountServices;
  admin: AdminServices | null;
}

const ServicesContext = createContext<ServicesValue | null>(null);

export function useServices(): ServicesValue {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("useServices outside <ServicesProvider>");
  return value;
}

function WithAdmin({
  account,
  children,
}: {
  account: AccountServices;
  children: ReactNode;
}): JSX.Element {
  const admin = useAdminServices();
  return <ServicesContext.Provider value={{ account, admin }}>{children}</ServicesContext.Provider>;
}

export function ServicesProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: ReactNode;
}): JSX.Element {
  const account = useAccountServices();
  if (isAdmin) return <WithAdmin account={account}>{children}</WithAdmin>;
  return (
    <ServicesContext.Provider value={{ account, admin: null }}>{children}</ServicesContext.Provider>
  );
}
