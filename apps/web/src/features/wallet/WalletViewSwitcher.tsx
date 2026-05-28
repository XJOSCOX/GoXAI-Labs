import { CircleDollarSign, WalletCards } from "lucide-react";

import { type WalletView } from "./walletUtils";

type WalletViewSwitcherProps = {
  onChange: (view: WalletView) => void;
  view: WalletView;
};

export function WalletViewSwitcher({ onChange, view }: WalletViewSwitcherProps) {
  return (
    <div className="wallet-view-switcher" aria-label="Wallet view">
      <button className={view === "creator" ? "active" : ""} onClick={() => onChange("creator")} type="button">
        <WalletCards size={16} />
        Creator wallet
      </button>
      <button className={view === "worker" ? "active" : ""} onClick={() => onChange("worker")} type="button">
        <CircleDollarSign size={16} />
        Worker earnings
      </button>
    </div>
  );
}
