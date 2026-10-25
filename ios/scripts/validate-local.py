#!/usr/bin/env python3
"""Offline structural checks. NOT a substitute for an Xcode build/test run."""
from __future__ import annotations
import json
import plistlib
import re
import struct
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

def parse_openstep(text):
    token = re.compile(r'\s+|//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|[{}()=;,]|[^\s{}()=;,"]+', re.S)
    tokens = []
    end = 0
    for match in token.finditer(text):
        assert not text[end:match.start()].strip(), "Untokenized OpenStep content"
        end = match.end()
        value = match.group()
        if value.isspace() or value.startswith(("//", "/*")):
            continue
        tokens.append(value)
    index = 0
    def expect(value):
        nonlocal index
        assert tokens[index] == value, (index, value, tokens[index])
        index += 1
    def read():
        nonlocal index
        value = tokens[index]
        index += 1
        if value == "{":
            result = {}
            while tokens[index] != "}":
                key = read()
                expect("=")
                assert key not in result, f"Duplicate OpenStep key: {key}"
                result[key] = read()
                expect(";")
            expect("}")
            return result
        if value == "(":
            result = []
            while tokens[index] != ")":
                result.append(read())
                if tokens[index] == ",":
                    expect(",")
                else:
                    break
            expect(")")
            return result
        return json.loads(value) if value.startswith('"') else value
    result = read()
    assert index == len(tokens), "Trailing OpenStep tokens"
    return result

def main():
    passed = []
    project = parse_openstep((ROOT / "Orbita.xcodeproj/project.pbxproj").read_text(encoding="utf-8"))
    objects = project["objects"]
    assert project["rootObject"] in objects
    passed.append("OpenStep project parsed; all object IDs unique")
    ref_keys = {"fileRef", "productRef", "target", "targetProxy", "containerPortal", "mainGroup",
                "productRefGroup", "buildConfigurationList", "productReference", "package"}
    list_keys = {"children", "buildConfigurations", "buildPhases", "dependencies", "packageReferences",
                 "packageProductDependencies", "targets", "files"}
    for key, value in objects.items():
        assert re.fullmatch(r"[A-F0-9]{24}", key), key
        for field in ref_keys & value.keys():
            assert value[field] in objects, (key, field, value[field])
        for field in list_keys & value.keys():
            for reference in value[field]:
                assert reference in objects, (key, field, reference)
    passed.append(f"{len(objects)} Xcode objects have valid references")
    swift_refs = []
    for value in objects.values():
        if value["isa"] == "PBXFileReference" and value.get("sourceTree") == "<group>":
            path = ROOT / value["path"]
            assert path.exists(), f"Missing reference: {path}"
            if path.suffix == ".swift":
                swift_refs.append(path.resolve())
    actual = list(ROOT.rglob("*.swift"))
    assert set(swift_refs) == {file.resolve() for file in actual}
    assert len(swift_refs) == len(set(swift_refs))
    passed.append(f"All {len(actual)} Swift source files referenced once")
    targets = [value for value in objects.values() if value["isa"] == "PBXNativeTarget"]
    # Extensão de broadcast (tela) é um target próprio desde a v2.1.
    assert {value["name"] for value in targets} == {"Orbita", "OrbitaTests", "OrbitaUITests", "BroadcastExtension"}
    for target in targets:
        sources = [objects[phase] for phase in target["buildPhases"]
                   if objects[phase]["isa"] == "PBXSourcesBuildPhase"]
        assert len(sources) == 1
        for build_id in sources[0]["files"]:
            path = objects[objects[build_id]["fileRef"]]["path"]
            if target["name"] == "Orbita":
                assert path.startswith("Orbita/")
            else:
                assert path.startswith(target["name"] + "/")
    passed.append("App, unit tests and UI tests have isolated build phases")
    for path in ROOT.rglob("*.xcscheme"):
        tree = ET.parse(path)
        for reference in tree.iter("BuildableReference"):
            assert reference.attrib["BlueprintIdentifier"] in objects
    ET.parse(ROOT / "Orbita.xcodeproj/project.xcworkspace/contents.xcworkspacedata")
    passed.append("Shared schemes and workspace XML parsed")
    info = plistlib.loads((ROOT / "Orbita/Resources/Info.plist").read_bytes())
    privacy = plistlib.loads((ROOT / "Orbita/Resources/PrivacyInfo.xcprivacy").read_bytes())
    assert info["NSCameraUsageDescription"] and info["NSMicrophoneUsageDescription"]
    # remote-notification: push (APNs) chega com o app em segundo plano.
    assert set(info["UIBackgroundModes"]) == {"audio", "remote-notification"}
    assert not info.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads", False)
    assert privacy["NSPrivacyTracking"] is False
    assert privacy["NSPrivacyAccessedAPITypes"][0]["NSPrivacyAccessedAPITypeReasons"] == ["CA92.1"]
    passed.append("Info and privacy plists parsed; no ATS bypass or unrelated background modes")
    assets = ROOT / "Orbita/Resources/Assets.xcassets"
    for path in assets.rglob("Contents.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for image in data.get("images", []):
            if "filename" not in image:
                continue
            png = path.parent / image["filename"]
            header = png.read_bytes()[:33]
            assert header[:8] == b"\x89PNG\r\n\x1a\n"
            width, height = struct.unpack(">II", header[16:24])
            if path.parent.suffix == ".appiconset":
                scale = int(image["scale"].rstrip("x"))
                size = int(image["size"].split("x")[0]) * scale
                assert (width, height) == (size, size)
                assert header[25] == 2, "App icon must be opaque RGB"
    passed.append("Asset JSON, PNG dimensions and opaque App Store icon validated")
    packages = [value for value in objects.values() if value["isa"] == "XCRemoteSwiftPackageReference"]
    assert len(packages) == 2
    assert {value["requirement"]["version"] for value in packages} == {"2.55.4", "2.18.0"}
    assert all(value["requirement"]["kind"] == "exactVersion" for value in packages)
    passed.append("Direct SDK version constraints are exact (transitive lock requires Xcode)")
    for path in actual:
        source = path.read_text(encoding="utf-8")
        assert not re.search(r"(?m)^<{7}|^={7}|^>{7}", source), path
        assert not re.search(r"sb_secret_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,}\.", source), path
        assert "WKWebView" not in source
    passed.append("No merge markers, embedded JWT/secret key or WebView implementation")
    unit_count = sum(len(re.findall(r"\bfunc test\w+\(", p.read_text(encoding="utf-8")))
                     for p in (ROOT / "OrbitaTests").glob("*.swift"))
    ui_count = sum(len(re.findall(r"\bfunc test\w+\(", p.read_text(encoding="utf-8")))
                   for p in (ROOT / "OrbitaUITests").glob("*.swift"))
    result = {
        "status": "static_structure_passed",
        "native_compilation_executed": False,
        "swift_typecheck_executed": False,
        "xctest_executed": False,
        "performance_measured": False,
        "unit_test_methods_present": unit_count,
        "ui_test_methods_present": ui_count,
        "checks": passed,
        "remaining": "Run scripts/validate-macos.sh with Xcode and test on physical iPhones."
    }
    (ROOT / "VERIFICATION.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"STRUCTURAL CHECK FAILED: {error}", file=sys.stderr)
        sys.exit(1)
