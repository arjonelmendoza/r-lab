// A ready-made sample activity for an Analytics Application course.
export const SAMPLE = {
  title: "Lab: Sales Analytics in R",
  instructions:
    "Answer all three problems using R. Each student gets **their own randomly generated dataset**, so your numbers will differ from your classmates'.\n\n" +
    "- Press **Run** to see your output.\n- Press **Check sample tests** to see whether you're on track.\n- Your instructor runs additional hidden tests after you submit.",
  durationMin: 60,
  packages: ["dplyr"],
  allowPaste: false,
  requireExplain: true,
  problems: [
    {
      title: "Revenue summary",
      prompt:
        "A data frame `sales` is already loaded with columns `region`, `product`, `units` and `price`.\n\n" +
        "1. Create a variable `total_revenue` equal to the sum of `units * price` across all rows.\n" +
        "2. Create a variable `avg_units` equal to the mean number of units per row.\n" +
        "3. Print both values using `cat()`, e.g. `Total revenue: 12345.67`.",
      starter: "# Explore the data first\nhead(sales)\n\ntotal_revenue <- \navg_units <- \n",
      setup:
        "set.seed(.seed)\nn <- 60\nsales <- data.frame(\n  region  = sample(c(\"North\", \"South\", \"East\", \"West\"), n, TRUE),\n" +
        "  product = sample(c(\"A\", \"B\", \"C\"), n, TRUE),\n  units   = sample(1:40, n, TRUE),\n  price   = round(runif(n, 50, 500), 2)\n)\nrm(n)",
      sampleTests:
        "1 | total_revenue exists | exists(\"total_revenue\", inherits = FALSE)\n" +
        "1 | avg_units exists | exists(\"avg_units\", inherits = FALSE)\n" +
        "1 | prints the total revenue | grepl(\"Total revenue\", .output, ignore.case = TRUE)",
      hiddenTests:
        "3 | total_revenue is correct | isTRUE(abs(total_revenue - sum(.ref$sales$units * .ref$sales$price)) < 0.01)\n" +
        "2 | avg_units is correct | isTRUE(abs(avg_units - mean(.ref$sales$units)) < 1e-6)\n" +
        "1 | sales data was not modified | identical(sales, .ref$sales)",
      solution:
        "total_revenue <- sum(sales$units * sales$price)\navg_units <- mean(sales$units)\ncat(\"Total revenue:\", total_revenue, \"\\n\")\ncat(\"Average units:\", avg_units, \"\\n\")",
    },
    {
      title: "Revenue by region (dplyr)",
      prompt:
        "Using the same `sales` data, create a data frame `by_region` with exactly two columns:\n\n" +
        "- `region`\n- `revenue`: total `units * price` for that region\n\n" +
        "Sort it from **highest to lowest** revenue. You may use `dplyr` (`group_by`, `summarise`, `arrange`).",
      starter: "library(dplyr)\n\nby_region <- sales %>%\n  \n\nby_region\n",
      setup:
        "set.seed(.seed)\nn <- 60\nsales <- data.frame(\n  region  = sample(c(\"North\", \"South\", \"East\", \"West\"), n, TRUE),\n" +
        "  product = sample(c(\"A\", \"B\", \"C\"), n, TRUE),\n  units   = sample(1:40, n, TRUE),\n  price   = round(runif(n, 50, 500), 2)\n)\nrm(n)",
      sampleTests:
        "1 | by_region is a data frame | is.data.frame(by_region)\n" +
        "1 | has columns region and revenue | identical(sort(names(by_region)), c(\"region\", \"revenue\"))",
      hiddenTests:
        "1 | one row per region | nrow(by_region) == length(unique(.ref$sales$region))\n" +
        "3 | revenue per region is correct | { r <- tapply(.ref$sales$units * .ref$sales$price, .ref$sales$region, sum); all(abs(by_region$revenue - r[as.character(by_region$region)]) < 0.01) }\n" +
        "2 | sorted highest to lowest | !is.unsorted(rev(by_region$revenue))",
      solution:
        "library(dplyr)\nby_region <- sales %>%\n  group_by(region) %>%\n  summarise(revenue = sum(units * price)) %>%\n  arrange(desc(revenue)) %>%\n  as.data.frame()\nby_region",
    },
    {
      title: "Predicting exam scores (regression)",
      prompt:
        "A data frame `scores` has columns `hours` (study hours), `attendance` (%) and `exam` (score).\n\n" +
        "1. Fit a linear model `model` that predicts `exam` from `hours` and `attendance`.\n" +
        "2. Store the coefficient for `hours` in `slope_hours`.\n" +
        "3. Store the model's R-squared in `r2`.\n" +
        "4. Make a scatter plot of `hours` vs `exam`.",
      starter: "head(scores)\n\nmodel <- \nslope_hours <- \nr2 <- \n",
      setup:
        "set.seed(.seed)\nn <- 80\nhours <- round(runif(n, 0, 12), 1)\nattendance <- round(runif(n, 60, 100))\n" +
        "exam <- round(35 + runif(1, 2.5, 4.5) * hours + 0.25 * attendance + rnorm(n, 0, 6), 1)\n" +
        "scores <- data.frame(hours, attendance, exam)\nrm(n, hours, attendance, exam)",
      sampleTests:
        "1 | model is an lm object | inherits(model, \"lm\")\n" +
        "1 | slope_hours is a single number | is.numeric(slope_hours) && length(slope_hours) == 1",
      hiddenTests:
        "2 | model uses hours and attendance | setequal(attr(terms(model), \"term.labels\"), c(\"hours\", \"attendance\"))\n" +
        "3 | slope_hours is correct | { m <- lm(exam ~ hours + attendance, data = .ref$scores); isTRUE(abs(unname(slope_hours) - coef(m)[[\"hours\"]]) < 1e-4) }\n" +
        "2 | r2 is correct | { m <- lm(exam ~ hours + attendance, data = .ref$scores); isTRUE(abs(unname(r2) - summary(m)$r.squared) < 1e-4) }\n" +
        "1 | draws a plot | grepl(\"plot\\\\s*\\\\(|ggplot\\\\s*\\\\(\", .code)",
      solution:
        "model <- lm(exam ~ hours + attendance, data = scores)\nslope_hours <- coef(model)[[\"hours\"]]\nr2 <- summary(model)$r.squared\nplot(scores$hours, scores$exam, xlab = \"Study hours\", ylab = \"Exam score\")\nabline(lm(exam ~ hours, data = scores), col = \"red\")",
    },
  ],
};
