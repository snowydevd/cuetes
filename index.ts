console.log("Hello via Bun!");
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient()

const response = await client.systemOne({
    state: {document: "i was charged twice. Please fix this ASAP"},
    questions: {
        category: choice("What is this ticket about?", {
            billing: null,
            technical: null,
            other: null
        })
    }
})

console.log(response.answers.category.choice)



