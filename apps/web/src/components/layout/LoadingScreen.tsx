import goxaiLogo from "../../assets/goxailab-logo.png";

export function LoadingScreen() {
  return (
    <main className="loading-screen">
      <img className="loading-logo" src={goxaiLogo} alt="" />
      <p>Loading GoXAi Lab</p>
    </main>
  );
}
