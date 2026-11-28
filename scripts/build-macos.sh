#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)/$(uname -m)" == Darwin/arm64 ]] || { echo "Build on an Apple silicon Mac." >&2; exit 1; }
[[ -f dist/index.html ]] || { echo "Build the frontend first with pnpm build." >&2; exit 1; }
version=$(node -p "require('./package.json').version")
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
export MACOSX_DEPLOYMENT_TARGET=14.0
app="$stage/image/Desktop Workspace.app"
contents="$app/Contents"
mkdir -p "$contents/MacOS" "$contents/Helpers" "$contents/Resources" release/macos
ditto dist "$contents/Resources/dist"
cp macos/Info.plist "$contents/Info.plist"
ditto macos/zh-Hans.lproj "$contents/Resources/zh-Hans.lproj"
cp macos/Workspace.icns "$contents/Resources/Workspace.icns"
plutil -replace CFBundleShortVersionString -string "$version" "$contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$contents/Info.plist"
dotnet publish macos/Helper/WorkspaceHost.csproj -c Release -r osx-arm64 \
  -p:PublishAot=true -p:StripSymbols=true -o "$stage/helper" --nologo
install -m 755 "$stage/helper/WorkspaceHost" "$contents/Helpers/WorkspaceHost"
xcrun swiftc -O -swift-version 5 -target arm64-apple-macos14.0 \
  macos/HostProcess.swift macos/WorkspaceApp.swift macos/main.swift -o "$contents/MacOS/Workspace"
for executable in "$contents/Helpers/WorkspaceHost" "$contents/MacOS/Workspace"; do
  [[ "$(lipo -archs "$executable")" == arm64 ]]
done
codesign --force --sign - --timestamp=none "$contents/Helpers/WorkspaceHost"
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"
ln -s /Applications "$stage/image/Applications"
dmg="$PWD/release/macos/Desktop-Workspace-$version-macos-arm64.dmg"
hdiutil create -quiet -volname "Desktop Workspace" -srcfolder "$stage/image" -format UDZO -o "$stage/workspace.dmg"
hdiutil verify -quiet "$stage/workspace.dmg"
mv -f "$stage/workspace.dmg" "$dmg"
echo "$dmg"
