export interface ActualAccount {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}

export interface ActualPayee {
  id: string;
  name: string;
  category?: string;
  transfer_acct?: string;
}

export interface ActualCategory {
  id: string;
  name: string;
  is_income?: boolean;
  cat_group?: string;
  hidden?: boolean;
}

export interface ActualTransaction {
  id?: string;
  account: string;
  date: string;
  amount: number;
  payee?: string;
  payee_name?: string;
  imported_payee?: string;
  category?: string;
  notes?: string;
  imported_id?: string;
  transfer_id?: string;
  cleared?: boolean;
  subtransactions?: unknown[];
}

export interface ActualApiUtils {
  amountToInteger(amount: number): number;
  integerToAmount(amount: number): number;
}

export interface ActualApi {
  init(config: { dataDir: string; serverURL: string; password?: string }): Promise<void>;
  shutdown(): Promise<void>;
  downloadBudget(syncId: string, options?: { password?: string }): Promise<void>;
  sync(): Promise<void>;
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<ActualPayee[]>;
  getCategories(): Promise<ActualCategory[]>;
  getTransactions(accountId: string, startDate?: string, endDate?: string): Promise<ActualTransaction[]>;
  addTransactions(
    accountId: string,
    transactions: ActualTransaction[],
    options?: { learnCategories?: boolean; runTransfers?: boolean }
  ): Promise<string[]>;
  utils: ActualApiUtils;
}
