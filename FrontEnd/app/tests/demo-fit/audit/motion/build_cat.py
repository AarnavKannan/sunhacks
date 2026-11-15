def category_of(cls, length):
    if cls == "truck": return "truck"
    if cls == "van": return "van"
    return "hatchback" if length < 4.45 else "sedan" if length < 4.95 else "suv"
