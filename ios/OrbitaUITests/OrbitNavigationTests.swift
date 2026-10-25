import XCTest

final class OrbitNavigationTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testNativeNavigationInOfflineDemo() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Comunidades"].waitForExistence(timeout: 8))
        let channel = app.buttons["channel-20000000-0000-4000-8000-000000000001"]
        XCTAssertTrue(channel.waitForExistence(timeout: 5))
        channel.tap()
        let composer = app.descendants(matching: .any)["message-composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertFalse(composer.isEnabled)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Conversa nativa — demonstração"
        shot.lifetime = .keepAlways
        add(shot)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Feed"].tap()
        XCTAssertTrue(app.navigationBars["Feed"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Você"].tap()
        XCTAssertTrue(app.staticTexts["Do seu jeito".uppercased()].waitForExistence(timeout: 5))
    }

    func testLargeTextDoesNotRemoveTabNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Conversas"].waitForExistence(timeout: 8))
        app.tabBars.buttons["Conversas"].tap()
        XCTAssertTrue(app.navigationBars["Conversas"].waitForExistence(timeout: 5))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Texto acessível — validar clipping manualmente"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
