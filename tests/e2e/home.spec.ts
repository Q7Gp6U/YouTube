import { expect, test } from "@playwright/test"

const videoUrl = "https://youtu.be/dQw4w9WgXcQ"
const dataImage = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="

test.describe("home summary flow", () => {
  test("completes a summary and resets back to the form", async ({ page }) => {
    await page.route("**/api/summarize", async (route) => {
      const requestBody = route.request().postDataJSON()

      if (requestBody.action === "start") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "completed",
            summary: "Кратко: Видео объясняет идею.\n\nГлавное:\n- Первый тезис.\n- Второй тезис.\n- Третий тезис.\n- Четвертый тезис.\n\nВывод: Смотреть целиком уже не обязательно.",
            videoTitle: "Тестовый ролик",
            model: "gemini-test",
            creditsRemaining: 8,
            essenceFrame: {
              sheetUrl: dataImage,
              frameWidth: 1,
              frameHeight: 1,
              columns: 1,
              rows: 1,
              column: 0,
              row: 0,
              timestampMs: 42000,
            },
          }),
        })
        return
      }

      await route.abort()
    })

    await page.goto("/")
    await page.getByPlaceholder("Вставьте ссылку на YouTube-видео...").fill(videoUrl)
    await page.getByRole("button", { name: "Получить суть" }).click()

    await expect(page.getByRole("heading", { name: "Готово!" })).toBeVisible()
    await expect(page.getByText("Тестовый ролик")).toBeVisible()
    await expect(page.getByText("Остаток после обработки: 8 кредит(ов)")).toBeVisible()
    await expect(page.getByText("Смотреть целиком уже не обязательно.")).toBeVisible()

    await page.getByRole("button", { name: "Сгенерировать для другого видео" }).click()

    await expect(page.getByPlaceholder("Вставьте ссылку на YouTube-видео...")).toBeVisible()
    await expect(page.getByText("Сейчас доступно 8 кредит(ов).", { exact: false })).toBeVisible()
  })

  test("shows an API error without leaving the input state", async ({ page }) => {
    await page.route("**/api/summarize", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          message: "Слишком много запросов. Повторите попытку чуть позже.",
          creditsRemaining: 4,
        }),
      })
    })

    await page.goto("/")
    await page.getByPlaceholder("Вставьте ссылку на YouTube-видео...").fill(videoUrl)
    await page.getByRole("button", { name: "Получить суть" }).click()

    await expect(page.getByText("Слишком много запросов. Повторите попытку чуть позже.")).toBeVisible()
    await expect(page.getByText("Сейчас доступно 4 кредит(ов).", { exact: false })).toBeVisible()
    await expect(page.getByPlaceholder("Вставьте ссылку на YouTube-видео...")).toBeVisible()
  })
})
