// Two built-in transcripts chosen to sound as different as possible: one is a
// genuine collaborative build, one is people talking past each other.

export interface Demo {
  id: string
  title: string
  blurb: string
  transcript: string
}

export const DEMOS: Demo[] = [
  {
    id: 'brainstorm',
    title: 'The Brainstorm',
    blurb: 'Two people building one idea together — questions answered, motifs picked up, harmony.',
    transcript: `Ada: What if the whole onboarding was just one screen?
Ravi: Oh I like that. One screen — so we drop the tour entirely?
Ada: Right, and we let them do a real task instead of watching a demo.
Ravi: Yes! And we could pre-fill the first project so it never feels empty.
Ada: Exactly, build on that — the empty state is where people bounce.
Ravi: So the first thing they see is already theirs. That's lovely.
Ada: Could we animate it assembling as they arrive?
Ravi: We could, a soft bloom, nothing heavy. It sets the tone.
Ada: Perfect. Let's make the first thirty seconds feel like a gift.
Ravi: Agreed. One screen, real task, and it greets them by name.`,
  },
  {
    id: 'argument',
    title: 'The Argument',
    blurb: 'Same topic, no listening — interruptions, contradiction, clashing keys.',
    transcript: `Ada: We need to cut the tour, it's just slowing everyone down.
Ravi: No, the tour is the only reason anyone understands the product—
Ada: That's not true, the data shows people skip it every single time.
Ravi: You always cherry-pick the data. It works fine for our real users.
Ada: Real users? Half of them churn on day one, that IS the problem.
Ravi: The problem is you never actually read the support tickets—
Ada: I read them constantly, don't tell me what I do.
Ravi: Then you'd know the tour isn't the issue at all.
Ada: It absolutely is the issue and you refuse to hear it.
Ravi: Ridiculous. We are going in circles because you won't listen.`,
  },
]
