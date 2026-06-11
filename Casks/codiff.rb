cask "codiff" do
  version "1.3.0.1"
  sha256 "f81c1c25ad764309d48bed5870854be2a14119c97aab28dbeb0041c52d83ad1f"

  url "https://github.com/thomaskistler/codiff/releases/download/v#{version}/Codiff-darwin-arm64-#{version}.zip"
  name "Codiff"
  desc "Visual diff tool for Git changes"
  homepage "https://github.com/thomaskistler/codiff"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on :macos

  app "Codiff.app"
  binary "#{appdir}/Codiff.app/Contents/Resources/app/bin/codiff-app",
         target: "codiff"

  zap trash: [
    "~/Library/Application Support/Codiff",
    "~/Library/Preferences/dev.nkzw-tech.codiff.plist",
    "~/Library/Saved Application State/dev.nkzw-tech.codiff.savedState",
  ]
end
